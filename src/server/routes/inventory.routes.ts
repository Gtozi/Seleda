/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 *
 * @deprecated LEGACY INVENTORY ROUTES — Superseded by /api/uinv-portal (unified uinv_* system).
 *
 * The following endpoint groups are DEPRECATED and replaced by /api/uinv-portal:
 *   - /categories       → use /api/uinv-portal/items (category derived from uinv_items.category)
 *   - /items            → use /api/uinv-portal/items or /api/uinv-portal/stock
 *   - /transactions     → use /api/uinv-portal/stock-ledger or /api/uinv-portal/adjustments
 *   - /requisitions     → use /api/uinv-portal/issues
 *   - /stock-count      → use /api/uinv-portal/counts
 *   - /analytics/*      → derive from /api/uinv-portal/stock or /api/uinv-portal/valuation
 *
 * The following F&B DOMAIN-SPECIFIC endpoints remain active (no unified equivalent):
 *   - /sub-recipes, /recipes, /production-history, /recipe-batch-production, /batch-production
 *   - /outlets, /menu-items, /consumption, /variance
 *
 * All inventory stock data should use the unified uinv_* system as the single source of truth.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';
import {
  resolveUinvItemByName,
  resolveFbStoreForOutlet,
  uinvProduceToStore,
  consumeLegacyItemToUnified,
  emptyResult,
  type DualWriteResult,
} from '../services/unifiedInventoryBridge';

const router = Router();

function dbNotConfigured(res: any) {
  return res.status(503).json({ error: 'Database not configured' });
}

/** Deprecation warning for superseded inventory stock endpoints. */
function deprecatedStockEndpoint(req: any, _res: any, next: any) {
  console.warn(`[DEPRECATED] /api/inventory${req.path} — use /api/uinv-portal instead`);
  next();
}

// ════════════════════════════════════════════════════════════════
// UNIFIED INVENTORY DUAL-WRITE
// F&B production/consumption endpoints still write to legacy
// inventory_transactions for frontend compatibility, but now also
// mirror stock movements into the unified uinv_* system so that
// dynamic par calculations and Central Warehouse replenishment see
// real F&B consumption data.
//
// The dual-write helpers live in services/unifiedInventoryBridge.ts
// and are shared with foodBeverage.routes.ts. They use the explicit
// inventory_items.uinv_item_id FK (migration 372) with a name-match
// fallback, and outlets.default_store_id for data-driven store routing.
// Dual-write failures are tracked and surfaced as warnings in API
// responses so divergence is visible rather than silent.
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// INVENTORY CATEGORIES — DEPRECATED: use /api/uinv-portal/items
// ════════════════════════════════════════════════════════════════════════
router.get('/categories', deprecatedStockEndpoint, authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('inventory_categories').select('*').order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/categories', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('inventory_categories').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/categories/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('inventory_categories').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/categories/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('inventory_categories').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// INVENTORY ITEMS — DEPRECATED: use /api/uinv-portal/items or /api/uinv-portal/stock
// ════════════════════════════════════════════════════════════════════════
router.get('/items', deprecatedStockEndpoint, authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { category_id, outlet_id, low_stock, item_type, search } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('inventory_items').select('*, category:inventory_categories(*), outlet:outlets(*)').order('name', { ascending: true });
  if (category_id) q = q.eq('category_id', category_id);
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  if (low_stock === 'true') q = q.lte('current_quantity', 'reorder_point');
  if (item_type) q = q.eq('item_type', item_type);
  if (search) q = q.ilike('name', `%${search}%`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/items', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('inventory_items').insert(req.body).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

router.put('/items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin.from('inventory_items').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

router.delete('/items/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('inventory_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// INVENTORY TRANSACTIONS — DEPRECATED: use /api/uinv-portal/stock-ledger
// ════════════════════════════════════════════════════════════════════════
// CATEGORIES — returns all inventory categories with parent/child hierarchy
// Also returns item_type enum values for frontend dropdowns.
// ════════════════════════════════════════════════════════════════════════
router.get('/categories', deprecatedStockEndpoint, authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('inventory_categories')
    .select('id, name, code, description, parent_category_id, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  // Build hierarchy: top-level categories with children nested
  const top = (data || []).filter((c: any) => !c.parent_category_id);
  const children = (data || []).filter((c: any) => c.parent_category_id);
  const tree = top.map((c: any) => ({
    ...c,
    children: children.filter((ch: any) => ch.parent_category_id === c.id),
  }));
  return res.json({
    categories: data || [],
    tree,
    item_types: ['perishable', 'non-perishable', 'frozen', 'dry', 'ambient'],
    transaction_types: [
      'consumption', 'transfer', 'waste', 'adjustment',
      'production_consumption', 'production_output',
      'goods_receipt', 'stock_count', 'cycle_count',
      'returns', 'expiry', 'spoilage',
    ],
  });
});

// ════════════════════════════════════════════════════════════════════════
// TRANSACTIONS — list with optional filters — DEPRECATED: use /api/uinv-portal/stock-ledger
// ════════════════════════════════════════════════════════════════════════
router.get('/transactions', deprecatedStockEndpoint, authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { item_id, transaction_type, outlet_id } = req.query as Record<string, string>;
  let q = supabaseAdmin.from('inventory_transactions').select('*, item:inventory_items(*), from_outlet:outlets!from_outlet_id(*), to_outlet:outlets!to_outlet_id(*)').order('transaction_date', { ascending: false });
  if (item_id) q = q.eq('item_id', item_id);
  if (transaction_type) q = q.eq('transaction_type', transaction_type);
  if (outlet_id) q = q.or('from_outlet_id', outlet_id).or('to_outlet_id', outlet_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/transactions', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const body = req.body;

  // Validate transaction_type against allowed list
  const allowedTypes = [
    'consumption', 'transfer', 'waste', 'adjustment',
    'production_consumption', 'production_output',
    'goods_receipt', 'stock_count', 'cycle_count',
    'returns', 'expiry', 'spoilage',
  ];
  if (body.transaction_type && !allowedTypes.includes(body.transaction_type)) {
    return res.status(400).json({ error: `Invalid transaction_type. Allowed: ${allowedTypes.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin.from('inventory_transactions').insert(body).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Update inventory item current_quantity based on transaction type
  // Stock-adding types: goods_receipt, production_output, returns (positive qty)
  // Stock-reducing types: consumption, waste, production_consumption, expiry, spoilage (negative qty)
  // Neutral types: transfer, adjustment, stock_count, cycle_count (handled separately)
  const stockAddingTypes = ['goods_receipt', 'production_output', 'returns'];
  const stockReducingTypes = ['consumption', 'waste', 'production_consumption', 'expiry', 'spoilage'];

  if (data.item_id && (stockAddingTypes.includes(data.transaction_type) || stockReducingTypes.includes(data.transaction_type))) {
    const { data: item } = await supabaseAdmin
      .from('inventory_items')
      .select('id, current_quantity')
      .eq('id', data.item_id)
      .maybeSingle();

    if (item) {
      const qty = Number(data.quantity || 0);
      const currentQty = Number(item.current_quantity || 0);
      const delta = stockAddingTypes.includes(data.transaction_type) ? qty : -qty;
      const newQty = Math.max(0, currentQty + delta);
      await supabaseAdmin
        .from('inventory_items')
        .update({ current_quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', data.item_id);
    }
  }

  return res.status(201).json(data);
});

// ════════════════════════════════════════════════════════════════════════
// SUB-RECIPES (for batch production)
// Returns sub-recipes with their ingredient lines + yield info so the
// frontend can plan batch production.
// ════════════════════════════════════════════════════════════════════════
router.get('/sub-recipes', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('sub_recipes')
    .select('id, name, category, yield_qty, yield_unit, portions, shelf_life_hours, is_active')
    .eq('is_active', true)
    .order('name');
  if (subErr) return res.status(500).json({ error: subErr.message });

  if (!subs || subs.length === 0) return res.json([]);

  const subIds = subs.map((s: any) => s.id);
  const { data: lines } = await supabaseAdmin
    .from('sub_recipe_lines')
    .select('id, sub_recipe_id, ingredient_id, quantity, unit, ingredient:ingredients(id, name)')
    .in('sub_recipe_id', subIds);

  const linesBySub = new Map<string, any[]>();
  for (const rl of (lines || [])) {
    if (!linesBySub.has(rl.sub_recipe_id)) linesBySub.set(rl.sub_recipe_id, []);
    const ing = Array.isArray(rl.ingredient) ? rl.ingredient[0] : rl.ingredient;
    linesBySub.get(rl.sub_recipe_id)!.push({
      ingredient_id: rl.ingredient_id,
      ingredient_name: ing?.name || 'Unknown',
      quantity_per_batch: Number(rl.quantity || 0),
      unit: rl.unit,
    });
  }

  // Check if batch product inventory items already exist (by name match)
  const subNames = subs.map((s: any) => s.name);
  const { data: invItems } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, current_quantity, unit_of_measure, unit_cost')
    .in('name', subNames);

  const invByName = new Map<string, any>();
  for (const inv of (invItems || [])) {
    if (!invByName.has(inv.name.toLowerCase())) invByName.set(inv.name.toLowerCase(), inv);
  }

  // Fetch recipes that reference each sub-recipe (via recipe_lines.sub_recipe_id)
  const { data: recipeLines } = await supabaseAdmin
    .from('recipe_lines')
    .select('id, sub_recipe_id, recipe_id, quantity, unit')
    .in('sub_recipe_id', subIds);

  const recipeIds = Array.from(new Set((recipeLines || []).map((rl: any) => rl.recipe_id).filter(Boolean)));
  let recipeById = new Map<string, any>();
  if (recipeIds.length > 0) {
    // Fetch recipes and menu items separately (no FK in schema cache)
    const { data: recipes, error: recErr } = await supabaseAdmin
      .from('recipes')
      .select('id, portions, menu_item_id, name')
      .in('id', recipeIds);
    const menuItemIds = Array.from(new Set((recipes || []).map((r: any) => r.menu_item_id).filter(Boolean)));
    let menuItemById = new Map<string, any>();
    if (menuItemIds.length > 0) {
      const { data: menuItems } = await supabaseAdmin
        .from('menu_items')
        .select('id, name')
        .in('id', menuItemIds);
      for (const mi of (menuItems || [])) {
        menuItemById.set(mi.id, mi);
      }
    }
    for (const r of (recipes || [])) {
      const mi = menuItemById.get(r.menu_item_id);
      recipeById.set(r.id, { id: r.id, portions: r.portions, menu_item_name: mi?.name || r.name || 'Unknown', menu_item_id: r.menu_item_id || null });
    }
  }

  // Build usage map: sub_recipe_id -> [{ menu_item_name, portions, qty_per_portion, unit }]
  const usageBySub = new Map<string, any[]>();
  for (const rl of (recipeLines || [])) {
    if (!rl.sub_recipe_id || !rl.recipe_id) continue;
    const recipe = recipeById.get(rl.recipe_id);
    if (!recipe) continue;
    if (!usageBySub.has(rl.sub_recipe_id)) usageBySub.set(rl.sub_recipe_id, []);
    usageBySub.get(rl.sub_recipe_id)!.push({
      recipe_id: rl.recipe_id,
      menu_item_name: recipe.menu_item_name,
      menu_item_id: recipe.menu_item_id,
      portions: recipe.portions || 1,
      qty_per_portion: Number(rl.quantity || 0),
      unit: rl.unit,
    });
  }

  const result = subs.map((s: any) => {
    const invItem = invByName.get(s.name.toLowerCase());
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      yield_qty: Number(s.yield_qty || 0),
      yield_unit: s.yield_unit,
      portions: s.portions || 1,
      shelf_life_hours: s.shelf_life_hours,
      lines: linesBySub.get(s.id) || [],
      inventory_item_id: invItem?.id || null,
      current_stock: invItem ? Number(invItem.current_quantity || 0) : 0,
      unit_cost: invItem ? Number(invItem.unit_cost || 0) : 0,
      used_by: usageBySub.get(s.id) || [],
    };
  });
  return res.json(result);
});

// ════════════════════════════════════════════════════════════════════════
// RECIPES — returns all recipes with their lines for batch production.
// Each recipe line references either an ingredient (raw) or a sub-recipe (semi-finished).
// ════════════════════════════════════════════════════════════════════════
router.get('/recipes', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  // Fetch recipes
  const { data: recipes, error: recErr } = await supabaseAdmin
    .from('recipes')
    .select('id, name, portions, yield, menu_item_id')
    .order('name');
  if (recErr) return res.status(500).json({ error: recErr.message });
  if (!recipes || recipes.length === 0) return res.json([]);

  // Fetch menu items for names
  const menuItemIds = Array.from(new Set(recipes.map((r: any) => r.menu_item_id).filter(Boolean)));
  let menuItemById = new Map<string, any>();
  if (menuItemIds.length > 0) {
    const { data: menuItems } = await supabaseAdmin
      .from('menu_items')
      .select('id, name')
      .in('id', menuItemIds);
    for (const mi of (menuItems || [])) menuItemById.set(mi.id, mi);
  }

  // Fetch recipe lines
  const recipeIds = recipes.map((r: any) => r.id);
  const { data: lines } = await supabaseAdmin
    .from('recipe_lines')
    .select('id, recipe_id, ingredient_id, sub_recipe_id, quantity, unit')
    .in('recipe_id', recipeIds);

  // Fetch ingredient names
  const ingredientIds = Array.from(new Set((lines || []).map((l: any) => l.ingredient_id).filter(Boolean)));
  let ingredientById = new Map<string, any>();
  if (ingredientIds.length > 0) {
    const { data: ingredients } = await supabaseAdmin
      .from('ingredients')
      .select('id, name')
      .in('id', ingredientIds);
    for (const ing of (ingredients || [])) ingredientById.set(ing.id, ing);
  }

  // Fetch sub-recipe names
  const subRecipeIds = Array.from(new Set((lines || []).map((l: any) => l.sub_recipe_id).filter(Boolean)));
  let subRecipeById = new Map<string, any>();
  if (subRecipeIds.length > 0) {
    const { data: subRecs } = await supabaseAdmin
      .from('sub_recipes')
      .select('id, name, yield_qty, yield_unit, portions')
      .in('id', subRecipeIds);
    for (const sr of (subRecs || [])) subRecipeById.set(sr.id, sr);
  }

  // Check if finished goods inventory items already exist (by menu item name)
  const menuItemNames = recipes.map((r: any) => menuItemById.get(r.menu_item_id)?.name).filter(Boolean);
  const { data: invItems } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, current_quantity, unit_of_measure, unit_cost')
    .in('name', menuItemNames);
  const invByName = new Map<string, any>();
  for (const inv of (invItems || [])) {
    if (!invByName.has(inv.name.toLowerCase())) invByName.set(inv.name.toLowerCase(), inv);
  }

  // Group lines by recipe
  const linesByRecipe = new Map<string, any[]>();
  for (const rl of (lines || [])) {
    if (!linesByRecipe.has(rl.recipe_id)) linesByRecipe.set(rl.recipe_id, []);
    const ing = rl.ingredient_id ? ingredientById.get(rl.ingredient_id) : null;
    const sr = rl.sub_recipe_id ? subRecipeById.get(rl.sub_recipe_id) : null;
    linesByRecipe.get(rl.recipe_id)!.push({
      ingredient_id: rl.ingredient_id,
      ingredient_name: ing?.name || null,
      sub_recipe_id: rl.sub_recipe_id,
      sub_recipe_name: sr?.name || null,
      sub_recipe_yield: sr ? Number(sr.yield_qty || 0) : 0,
      sub_recipe_yield_unit: sr?.yield_unit || null,
      sub_recipe_portions: sr?.portions || 1,
      quantity_per_portion: Number(rl.quantity || 0),
      unit: rl.unit,
      type: rl.sub_recipe_id ? 'sub-recipe' : 'ingredient',
    });
  }

  const result = recipes.map((r: any) => {
    const mi = menuItemById.get(r.menu_item_id);
    const invItem = mi ? invByName.get(mi.name.toLowerCase()) : null;
    return {
      id: r.id,
      name: mi?.name || r.name || 'Untitled',
      portions: r.portions || 1,
      yield: Number(r.yield || 0),
      menu_item_id: r.menu_item_id,
      menu_item_name: mi?.name || 'Unknown',
      lines: linesByRecipe.get(r.id) || [],
      inventory_item_id: invItem?.id || null,
      current_stock: invItem ? Number(invItem.current_quantity || 0) : 0,
      unit_cost: invItem ? Number(invItem.unit_cost || 0) : 0,
    };
  });
  return res.json(result);
});

// ════════════════════════════════════════════════════════════════════════
// PRODUCTION HISTORY — returns production_output transactions grouped by item.
// Query params: ?item_id=... (optional, filters to a single inventory item)
// Returns the most recent production_output transactions with item + outlet info.
// ════════════════════════════════════════════════════════════════════════
router.get('/production-history', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { item_id } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('inventory_transactions')
    .select('id, item_id, transaction_type, quantity, unit_cost, total_cost, reason, performed_by, transaction_date, to_outlet_id, item:inventory_items(id, name, unit_of_measure), to_outlet:outlets!to_outlet_id(id, name)')
    .eq('transaction_type', 'production_output')
    .order('transaction_date', { ascending: false })
    .limit(100);
  if (item_id) q = q.eq('item_id', item_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ════════════════════════════════════════════════════════════════════════
// RECIPE BATCH PRODUCTION — produce a batch of a recipe (finished good)
//
// Body: {
//   recipe_id: string,
//   batch_count: number,   // how many portions/batches to produce
//   outlet_id: string,
//   date?: string (ISO)
// }
//
// For each recipe line:
//   - If ingredient: deduct raw ingredient from inventory (production_consumption)
//   - If sub-recipe: deduct semi-finished batch product from inventory (production_consumption)
//
// Creates a production_output transaction for the finished good.
// ════════════════════════════════════════════════════════════════════════
router.post('/recipe-batch-production', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { recipe_id, batch_count, outlet_id, date } = req.body;

  if (!recipe_id || !batch_count || !outlet_id) {
    return res.status(400).json({ error: 'recipe_id, batch_count, and outlet_id are required' });
  }

  // 1. Fetch the recipe
  const { data: recipe, error: recErr } = await supabaseAdmin
    .from('recipes')
    .select('id, name, portions, yield, menu_item_id')
    .eq('id', recipe_id)
    .maybeSingle();
  if (recErr) return res.status(500).json({ error: recErr.message });
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

  // Fetch menu item name
  let menuItemName = recipe.name || 'Untitled';
  if (recipe.menu_item_id) {
    const { data: mi } = await supabaseAdmin
      .from('menu_items')
      .select('id, name')
      .eq('id', recipe.menu_item_id)
      .maybeSingle();
    if (mi) menuItemName = mi.name;
  }

  // 2. Fetch recipe lines
  const { data: lines, error: linesErr } = await supabaseAdmin
    .from('recipe_lines')
    .select('id, ingredient_id, sub_recipe_id, quantity, unit')
    .eq('recipe_id', recipe_id);
  if (linesErr) return res.status(500).json({ error: linesErr.message });
  if (!lines || lines.length === 0) {
    return res.status(400).json({ error: 'Recipe has no ingredient lines' });
  }

  // 3. Collect ingredient names and sub-recipe IDs
  const ingredientIds = Array.from(new Set(lines.map((l: any) => l.ingredient_id).filter(Boolean)));
  const subRecipeIds = Array.from(new Set(lines.map((l: any) => l.sub_recipe_id).filter(Boolean)));

  // Fetch ingredient names
  let ingredientById = new Map<string, any>();
  if (ingredientIds.length > 0) {
    const { data: ingredients } = await supabaseAdmin
      .from('ingredients')
      .select('id, name')
      .in('id', ingredientIds);
    for (const ing of (ingredients || [])) ingredientById.set(ing.id, ing);
  }

  // Fetch sub-recipe names (for matching to semi-finished inventory items)
  let subRecipeById = new Map<string, any>();
  if (subRecipeIds.length > 0) {
    const { data: subRecs } = await supabaseAdmin
      .from('sub_recipes')
      .select('id, name, yield_qty, yield_unit, portions')
      .in('id', subRecipeIds);
    for (const sr of (subRecs || [])) subRecipeById.set(sr.id, sr);
  }

  // 4. Match ingredients and sub-recipes to inventory items by name
  const ingredientNames = Array.from(ingredientById.values()).map((i: any) => i.name).filter(Boolean);
  const subRecipeNames = Array.from(subRecipeById.values()).map((s: any) => s.name).filter(Boolean);
  const allNames = [...ingredientNames, ...subRecipeNames];

  const { data: invItems } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, unit_cost, unit_of_measure, current_quantity')
    .in('name', allNames);

  const invByName = new Map<string, any>();
  for (const inv of (invItems || [])) {
    if (!invByName.has(inv.name.toLowerCase())) invByName.set(inv.name.toLowerCase(), inv);
  }

  // 5. Find or create the finished good inventory item
  const finishedCat = await supabaseAdmin
    .from('inventory_categories')
    .select('id')
    .eq('code', 'FINISHED')
    .maybeSingle();

  let finishedInvItem: any = null;
  const { data: existing } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, current_quantity, unit_of_measure, unit_cost')
    .eq('name', menuItemName)
    .maybeSingle();

  if (existing) {
    finishedInvItem = existing;
  } else if (finishedCat.data) {
    const { data: newItem, error: newErr } = await supabaseAdmin
      .from('inventory_items')
      .insert({
        name: menuItemName,
        category_id: finishedCat.data.id,
        outlet_id,
        unit_of_measure: 'PCS',
        current_quantity: 0,
        minimum_stock: 0,
        reorder_point: 0,
        unit_cost: 0,
        location: 'Main Store',
        item_type: 'perishable',
        is_active: true,
      })
      .select('id, name, current_quantity, unit_of_measure, unit_cost')
      .single();
    if (newErr) return res.status(500).json({ error: `Failed to create finished good inventory item: ${newErr.message}` });
    finishedInvItem = newItem;
  } else {
    return res.status(500).json({ error: 'Finished Goods category (FINISHED) not found' });
  }

  // 6. Calculate production transactions
  const txDate = date || new Date().toISOString();
  const portions = recipe.portions || 1;
  const totalOutputQty = Number(batch_count); // batch_count = number of portions to produce
  const transactions: any[] = [];
  const unmatched: string[] = [];
  let totalRawCost = 0;

  for (const rl of lines) {
    // Determine what to consume: ingredient or sub-recipe batch product
    let invName: string | null = null;
    if (rl.sub_recipe_id) {
      const sr = subRecipeById.get(rl.sub_recipe_id);
      invName = sr?.name || null;
    } else if (rl.ingredient_id) {
      const ing = ingredientById.get(rl.ingredient_id);
      invName = ing?.name || null;
    }

    if (!invName) {
      unmatched.push(`Unknown ingredient/sub-recipe in line ${rl.id}`);
      continue;
    }

    const invItem = invByName.get(invName.toLowerCase());
    if (!invItem) {
      unmatched.push(invName);
      continue;
    }

    // Quantity per portion × batch_count (number of portions)
    const consumeQty = Number(rl.quantity || 0) * Number(batch_count);
    const unitCost = Number(invItem.unit_cost || 0);
    const lineCost = consumeQty * unitCost;
    totalRawCost += lineCost;

    transactions.push({
      item_id: invItem.id,
      transaction_type: 'production_consumption',
      quantity: consumeQty,
      unit_cost: unitCost,
      total_cost: lineCost,
      from_outlet_id: outlet_id,
      reason: `Recipe batch production: ${batch_count}× ${menuItemName} (consumed ${invName})`,
      performed_by: (req as any).user?.name || 'system',
      transaction_date: txDate,
    });
  }

  if (transactions.length === 0) {
    return res.status(400).json({
      error: 'No recipe lines could be matched to inventory items',
      unmatched_ingredients: unmatched,
    });
  }

  // 7. Insert production_consumption transactions
  const { data: consumed, error: consumeErr } = await supabaseAdmin
    .from('inventory_transactions')
    .insert(transactions)
    .select();
  if (consumeErr) return res.status(500).json({ error: consumeErr.message });

  // 8. Update raw ingredient inventory quantities (deduct)
  for (const tx of consumed) {
    const { data: item } = await supabaseAdmin
      .from('inventory_items')
      .select('id, current_quantity')
      .eq('id', tx.item_id)
      .maybeSingle();
    if (item) {
      const newQty = Math.max(0, Number(item.current_quantity || 0) - Number(tx.quantity || 0));
      await supabaseAdmin
        .from('inventory_items')
        .update({ current_quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', tx.item_id);
    }
  }

  // 9. Calculate finished good unit cost
  const finishedUnitCost = totalOutputQty > 0 ? totalRawCost / totalOutputQty : 0;

  // 10. Insert production_output transaction
  const { data: outputTx, error: outputErr } = await supabaseAdmin
    .from('inventory_transactions')
    .insert({
      item_id: finishedInvItem.id,
      transaction_type: 'production_output',
      quantity: totalOutputQty,
      unit_cost: finishedUnitCost,
      total_cost: totalRawCost,
      to_outlet_id: outlet_id,
      reason: `Recipe batch production output: ${batch_count}× ${menuItemName}`,
      performed_by: (req as any).user?.name || 'system',
      transaction_date: txDate,
    })
    .select()
    .single();
  if (outputErr) return res.status(500).json({ error: outputErr.message });

  // 11. Update finished good inventory quantity (add)
  const newFinishedQty = Number(finishedInvItem.current_quantity || 0) + totalOutputQty;
  await supabaseAdmin
    .from('inventory_items')
    .update({
      current_quantity: newFinishedQty,
      unit_cost: finishedUnitCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', finishedInvItem.id);

  // 12. Dual-write to unified uinv_* system
  const fbStoreId = await resolveFbStoreForOutlet(outlet_id);
  const performedBy = (req as any).user?.name || 'system';
  const recipeRef = `FB-RECIPE-${Date.now().toString().slice(-6)}`;
  const dualWriteResult: DualWriteResult = emptyResult();
  for (const tx of consumed) {
    await consumeLegacyItemToUnified({
      propertyId: null,
      legacyItemId: tx.item_id,
      legacyItemName: '',
      storeId: fbStoreId,
      qty: Number(tx.quantity || 0),
      unitCost: Number(tx.unit_cost || 0),
      reference: recipeRef,
      reason: `Recipe batch production: ${menuItemName}`,
      performedBy,
      txDate,
      result: dualWriteResult,
    });
  }
  const finishedUinvItem = await resolveUinvItemByName(menuItemName);
  let finishedDualWriteOk = false;
  if (finishedUinvItem) {
    finishedDualWriteOk = await uinvProduceToStore({
      propertyId: null,
      itemId: finishedUinvItem.id,
      storeId: fbStoreId,
      qty: totalOutputQty,
      unitCost: finishedUnitCost,
      reference: recipeRef,
      reason: `Recipe batch production output: ${menuItemName}`,
      performedBy,
      txDate,
    });
    if (finishedDualWriteOk) dualWriteResult.successes += 1;
    else dualWriteResult.failures.push({ itemId: finishedUinvItem.id, itemName: menuItemName, reason: 'Finished-good produce write failed', stage: 'produce' });
  }

  return res.status(201).json({
    recipe_id,
    recipe_name: menuItemName,
    batch_count,
    total_output: totalOutputQty,
    total_raw_cost: totalRawCost,
    finished_unit_cost: finishedUnitCost,
    finished_product_stock_after: newFinishedQty,
    transactions_consumed: consumed?.length || 0,
    transaction_output_id: outputTx?.id,
    unmatched_ingredients: unmatched,
    dual_write: {
      unified_successes: dualWriteResult.successes,
      unified_failures: dualWriteResult.failures,
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
// BATCH PRODUCTION — produce a batch of a sub-recipe
//
// Body: {
//   sub_recipe_id: string,
//   batch_count: number,   // how many batches to produce
//   outlet_id: string,     // where the production happens (and output is stored)
//   date?: string (ISO)
// }
//
// For each batch:
//   raw_ingredient_qty = sub_recipe_line.quantity × batch_count
//   output_qty = sub_recipe.yield_qty × batch_count
//
// Creates:
//   1. production_consumption transactions for each raw ingredient (deduct)
//   2. A production_output transaction for the batch product (add)
//   3. Creates or updates an inventory_items entry for the batch product
//      (category = SEMI / Semi-Finished Goods)
//
// Financial posting (per spec Section 12):
//   Dr Semi-Finished Inventory
//   Cr Raw Material Inventory
// ════════════════════════════════════════════════════════════════════════
router.post('/batch-production', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { sub_recipe_id, batch_count, outlet_id, date } = req.body;

  if (!sub_recipe_id || !batch_count || !outlet_id) {
    return res.status(400).json({ error: 'sub_recipe_id, batch_count, and outlet_id are required' });
  }

  // 1. Fetch the sub-recipe
  const { data: sub, error: subErr } = await supabaseAdmin
    .from('sub_recipes')
    .select('id, name, yield_qty, yield_unit, portions')
    .eq('id', sub_recipe_id)
    .maybeSingle();
  if (subErr) return res.status(500).json({ error: subErr.message });
  if (!sub) return res.status(404).json({ error: 'Sub-recipe not found' });

  // 2. Fetch sub-recipe lines (raw ingredients)
  const { data: lines, error: linesErr } = await supabaseAdmin
    .from('sub_recipe_lines')
    .select('id, ingredient_id, quantity, unit, ingredient:ingredients(id, name)')
    .eq('sub_recipe_id', sub_recipe_id);
  if (linesErr) return res.status(500).json({ error: linesErr.message });
  if (!lines || lines.length === 0) {
    return res.status(400).json({ error: 'Sub-recipe has no ingredient lines' });
  }

  // 3. Match ingredients to inventory_items by name
  const ingredientNames = lines.map((rl: any) => {
    const ing = Array.isArray(rl.ingredient) ? rl.ingredient[0] : rl.ingredient;
    return ing?.name;
  }).filter(Boolean);

  const { data: rawInvItems } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, unit_cost, unit_of_measure, current_quantity')
    .in('name', ingredientNames);

  const rawInvMap = new Map<string, any>();
  for (const inv of (rawInvItems || [])) {
    if (!rawInvMap.has(inv.name.toLowerCase())) rawInvMap.set(inv.name.toLowerCase(), inv);
  }

  // 4. Find or create the batch product inventory item (Semi-Finished Goods)
  const semiCat = await supabaseAdmin
    .from('inventory_categories')
    .select('id')
    .eq('code', 'SEMI')
    .maybeSingle();

  let batchInvItem: any = null;
  const { data: existing } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, current_quantity, unit_of_measure, unit_cost')
    .eq('name', sub.name)
    .maybeSingle();

  if (existing) {
    batchInvItem = existing;
  } else if (semiCat.data) {
    // Create the batch product inventory item
    const { data: newItem, error: newErr } = await supabaseAdmin
      .from('inventory_items')
      .insert({
        name: sub.name,
        category_id: semiCat.data.id,
        outlet_id,
        unit_of_measure: sub.yield_unit,
        current_quantity: 0,
        minimum_stock: 0,
        reorder_point: 0,
        unit_cost: 0,
        location: 'Main Store',
        is_active: true,
      })
      .select('id, name, current_quantity, unit_of_measure, unit_cost')
      .single();
    if (newErr) return res.status(500).json({ error: `Failed to create batch product inventory item: ${newErr.message}` });
    batchInvItem = newItem;
  } else {
    return res.status(500).json({ error: 'Semi-Finished Goods category (SEMI) not found in inventory_categories' });
  }

  // 5. Calculate production transactions
  const txDate = date || new Date().toISOString();
  const totalYieldQty = Number(sub.yield_qty) * Number(batch_count);
  const transactions: any[] = [];
  const unmatched: string[] = [];
  let totalRawCost = 0;

  for (const rl of lines) {
    const ing = Array.isArray(rl.ingredient) ? rl.ingredient[0] : rl.ingredient;
    const ingredientName = ing?.name || 'Unknown';
    const rawInv = rawInvMap.get(ingredientName.toLowerCase());

    if (!rawInv) {
      unmatched.push(ingredientName);
      continue;
    }

    const consumeQty = Number(rl.quantity || 0) * Number(batch_count);
    const unitCost = Number(rawInv.unit_cost || 0);
    const lineCost = consumeQty * unitCost;
    totalRawCost += lineCost;

    transactions.push({
      item_id: rawInv.id,
      transaction_type: 'production_consumption',
      quantity: consumeQty,
      unit_cost: unitCost,
      total_cost: lineCost,
      from_outlet_id: outlet_id,
      reason: `Batch production: ${batch_count}× ${sub.name}`,
      performed_by: (req as any).user?.name || 'system',
      transaction_date: txDate,
    });
  }

  if (transactions.length === 0) {
    return res.status(400).json({
      error: 'No sub-recipe lines could be matched to inventory items',
      unmatched_ingredients: unmatched,
    });
  }

  // 6. Calculate batch product unit cost
  const batchUnitCost = totalYieldQty > 0 ? totalRawCost / totalYieldQty : 0;

  // 7. Insert production_consumption transactions
  const { data: consumed, error: consumeErr } = await supabaseAdmin
    .from('inventory_transactions')
    .insert(transactions)
    .select();
  if (consumeErr) return res.status(500).json({ error: consumeErr.message });

  // 8. Insert production_output transaction (add batch product to inventory)
  const { data: outputTx, error: outputErr } = await supabaseAdmin
    .from('inventory_transactions')
    .insert({
      item_id: batchInvItem.id,
      transaction_type: 'production_output',
      quantity: totalYieldQty,
      unit_cost: batchUnitCost,
      total_cost: totalRawCost,
      to_outlet_id: outlet_id,
      reason: `Batch production output: ${batch_count}× ${sub.name} (${totalYieldQty} ${sub.yield_unit})`,
      performed_by: (req as any).user?.name || 'system',
      transaction_date: txDate,
    })
    .select()
    .single();
  if (outputErr) return res.status(500).json({ error: outputErr.message });

  // 9. Update batch product inventory item: current_quantity += totalYieldQty, unit_cost = batchUnitCost
  const newStock = Number(batchInvItem.current_quantity || 0) + totalYieldQty;
  await supabaseAdmin
    .from('inventory_items')
    .update({ current_quantity: newStock, unit_cost: Number(batchUnitCost.toFixed(4)), updated_at: new Date().toISOString() })
    .eq('id', batchInvItem.id);

  // 10. Dual-write to unified uinv_* system
  const fbStoreId = await resolveFbStoreForOutlet(outlet_id);
  const performedBy = (req as any).user?.name || 'system';
  const batchRef = `FB-BATCH-${Date.now().toString().slice(-6)}`;
  const dualWriteResult: DualWriteResult = emptyResult();
  // Consume raw ingredients from unified store
  for (const tx of consumed) {
    await consumeLegacyItemToUnified({
      propertyId: null,
      legacyItemId: tx.item_id,
      legacyItemName: '',
      storeId: fbStoreId,
      qty: Number(tx.quantity || 0),
      unitCost: Number(tx.unit_cost || 0),
      reference: batchRef,
      reason: `Batch production consumption: ${sub.name}`,
      performedBy,
      txDate,
      result: dualWriteResult,
    });
  }
  // Produce batch product to unified store
  const batchUinvItem = await resolveUinvItemByName(sub.name);
  let batchDualWriteOk = false;
  if (batchUinvItem) {
    batchDualWriteOk = await uinvProduceToStore({
      propertyId: null,
      itemId: batchUinvItem.id,
      storeId: fbStoreId,
      qty: totalYieldQty,
      unitCost: batchUnitCost,
      reference: batchRef,
      reason: `Batch production output: ${sub.name}`,
      performedBy,
      txDate,
    });
    if (batchDualWriteOk) dualWriteResult.successes += 1;
    else dualWriteResult.failures.push({ itemId: batchUinvItem.id, itemName: sub.name, reason: 'Batch-product produce write failed', stage: 'produce' });
  }

  return res.status(201).json({
    success: true,
    sub_recipe_name: sub.name,
    batch_count: Number(batch_count),
    total_yield: totalYieldQty,
    yield_unit: sub.yield_unit,
    raw_ingredients_consumed: consumed.length,
    unmatched_ingredients: unmatched,
    total_raw_cost: Number(totalRawCost.toFixed(2)),
    batch_unit_cost: Number(batchUnitCost.toFixed(4)),
    batch_product_stock_after: Number(newStock.toFixed(2)),
    production_consumption_transactions: consumed,
    production_output_transaction: outputTx,
    dual_write: {
      unified_successes: dualWriteResult.successes,
      unified_failures: dualWriteResult.failures,
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
// MENU ITEMS + RECIPES (for consumption recording)
// Returns menu items with their recipe lines so the frontend can
// auto-calculate theoretical consumption = recipe_line.quantity × servings.
// ════════════════════════════════════════════════════════════════════════
router.get('/outlets', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('outlets')
    .select('id, name')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get('/menu-items', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlet_id } = req.query as Record<string, string>;
  // 1. Fetch menu items
  let q = supabaseAdmin
    .from('menu_items')
    .select('id, name, category, selling_price, outlet_id, is_active')
    .eq('is_active', true)
    .order('name');
  if (outlet_id) q = q.eq('outlet_id', outlet_id);
  const { data: items, error: itemsError } = await q;
  if (itemsError) return res.status(500).json({ error: itemsError.message });

  if (!items || items.length === 0) return res.json([]);

  // 2. Fetch recipes for these menu items (no FK from recipes.menu_item_id → menu_items,
  //    so we can't use nested embed — query separately)
  const menuItemIds = items.map((m: any) => m.id);
  const { data: recipes } = await supabaseAdmin
    .from('recipes')
    .select('id, menu_item_id, portions')
    .in('menu_item_id', menuItemIds);

  // 3. Fetch recipe lines for these recipes
  const recipeIds = (recipes || []).map((r: any) => r.id);
  let recipeLines: any[] = [];
  if (recipeIds.length > 0) {
    const { data: rl } = await supabaseAdmin
      .from('recipe_lines')
      .select('id, recipe_id, ingredient_id, quantity, unit, ingredient:ingredients(id, name)')
      .in('recipe_id', recipeIds);
    recipeLines = rl || [];
  }

  // 4. Build maps
  const recipeByMenuItem = new Map<string, any>();
  for (const r of (recipes || [])) {
    recipeByMenuItem.set(r.menu_item_id, r);
  }
  const linesByRecipe = new Map<string, any[]>();
  for (const rl of recipeLines) {
    const rid = rl.recipe_id;
    if (!linesByRecipe.has(rid)) linesByRecipe.set(rid, []);
    const ing = Array.isArray(rl.ingredient) ? rl.ingredient[0] : rl.ingredient;
    linesByRecipe.get(rid)!.push({
      recipe_line_id: rl.id,
      ingredient_id: rl.ingredient_id,
      ingredient_name: ing?.name || 'Unknown',
      quantity_per_portion: Number(rl.quantity || 0),
      unit: rl.unit,
    });
  }

  // 5. Assemble
  const menuItems = items.map((m: any) => {
    const recipe = recipeByMenuItem.get(m.id);
    const lines = recipe ? (linesByRecipe.get(recipe.id) || []) : [];
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      selling_price: Number(m.selling_price || 0),
      outlet_id: m.outlet_id,
      recipe_id: recipe?.id || null,
      portions: recipe?.portions || 1,
      recipe_lines: lines,
    };
  });
  return res.json(menuItems);
});

// ════════════════════════════════════════════════════════════════════════
// RECORD CONSUMPTION — calculates theoretical from recipe × servings
//
// Body: {
//   menu_item_id: string,
//   servings_sold: number,
//   outlet_id: string,
//   date?: string (ISO),
//   actual_quantities?: { ingredient_id: string, actual_qty: number }[]
// }
//
// For each recipe line:
//   theoretical_qty = recipe_line.quantity × servings_sold / recipe.portions
//   actual_qty = from actual_quantities[] or defaults to theoretical (no variance)
//   quantity = actual_qty (the stock movement amount)
//
// Creates one inventory_transactions row per recipe line ingredient, with
// menu_item_id and recipe_id populated so variance can be traced back.
// ════════════════════════════════════════════════════════════════════════
router.post('/consumption', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { menu_item_id, servings_sold, outlet_id, date, actual_quantities } = req.body;

  if (!menu_item_id || !servings_sold || !outlet_id) {
    return res.status(400).json({ error: 'menu_item_id, servings_sold, and outlet_id are required' });
  }

  // 1. Fetch the menu item's recipe with lines + ingredients + sub_recipe refs
  const { data: recipe, error: recipeError } = await supabaseAdmin
    .from('recipes')
    .select('id, portions, recipe_lines:recipe_lines(id, ingredient_id, quantity, unit, sub_recipe_id, ingredient:ingredients(id, name))')
    .eq('menu_item_id', menu_item_id)
    .maybeSingle();
  if (recipeError) return res.status(500).json({ error: recipeError.message });
  if (!recipe || !recipe.recipe_lines || recipe.recipe_lines.length === 0) {
    return res.status(404).json({ error: 'No recipe found for this menu item' });
  }

  const portions = recipe.portions || 1;
  const multiplier = Number(servings_sold) / portions;

  // 2. Collect all ingredient names AND sub-recipe IDs for inventory matching
  const ingredientNames = (recipe.recipe_lines as any[]).map((rl: any) => {
    const ing = Array.isArray(rl.ingredient) ? rl.ingredient[0] : rl.ingredient;
    return ing?.name;
  }).filter(Boolean);

  // Fetch sub-recipes referenced in recipe lines (for batch product matching)
  const subRecipeIds = (recipe.recipe_lines as any[])
    .map((rl: any) => rl.sub_recipe_id)
    .filter(Boolean);
  let subRecipeMap = new Map<string, any>();
  if (subRecipeIds.length > 0) {
    const { data: subRecs } = await supabaseAdmin
      .from('sub_recipes')
      .select('id, name, yield_qty, yield_unit, portions')
      .in('id', subRecipeIds);
    for (const sr of (subRecs || [])) {
      subRecipeMap.set(sr.id, sr);
    }
  }

  // Collect sub-recipe names too (for inventory matching)
  const subRecipeNames = Array.from(subRecipeMap.values()).map((sr: any) => sr.name);
  const allNames = [...ingredientNames, ...subRecipeNames];

  const { data: inventoryItems } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, unit_cost, unit_of_measure')
    .in('name', allNames);

  // Build a name → inventory_item map (first match wins)
  const invMap = new Map<string, any>();
  for (const inv of (inventoryItems || [])) {
    if (!invMap.has(inv.name.toLowerCase())) {
      invMap.set(inv.name.toLowerCase(), inv);
    }
  }

  // 3. Build actual_quantities map: ingredient_id → actual_qty
  const actualMap = new Map<string, number>();
  if (actual_quantities && Array.isArray(actual_quantities)) {
    for (const aq of actual_quantities) {
      actualMap.set(aq.ingredient_id, Number(aq.actual_qty));
    }
  }

  // 4. Build transaction rows
  // For recipe lines that reference a sub_recipe_id:
  //   - Consume from the batch product inventory item (matched by sub_recipe.name)
  //   - The quantity per portion = sub_recipe.yield_qty / sub_recipe.portions
  //   - theoretical_qty = (yield_qty / portions) × servings_sold
  // For normal recipe lines (ingredient_id only):
  //   - Consume from the raw ingredient inventory item (as before)
  const txDate = date || new Date().toISOString();
  const transactions: any[] = [];
  const unmatched: string[] = [];
  const batchProductsConsumed: string[] = [];

  for (const rl of (recipe.recipe_lines as any[])) {
    const ing = Array.isArray(rl.ingredient) ? rl.ingredient[0] : rl.ingredient;
    const subRecipe = rl.sub_recipe_id ? subRecipeMap.get(rl.sub_recipe_id) : null;

    // If this line references a sub-recipe, consume from the batch product
    if (subRecipe) {
      const batchInvItem = invMap.get(subRecipe.name.toLowerCase());
      if (!batchInvItem) {
        unmatched.push(`${subRecipe.name} (batch product — not in inventory, produce a batch first)`);
        continue;
      }

      // Quantity per portion = yield_qty / portions (of the sub-recipe)
      const subPortions = subRecipe.portions || 1;
      const qtyPerPortion = Number(subRecipe.yield_qty || 0) / subPortions;
      const theoreticalQty = qtyPerPortion * multiplier;
      const actualQty = actualMap.has(ing?.id) ? actualMap.get(ing?.id)! : theoreticalQty;
      const unitCost = Number(batchInvItem.unit_cost || 0);

      transactions.push({
        item_id: batchInvItem.id,
        transaction_type: 'consumption',
        quantity: actualQty,
        unit_cost: unitCost,
        total_cost: actualQty * unitCost,
        from_outlet_id: outlet_id,
        reason: `Consumption for ${servings_sold} servings (from batch: ${subRecipe.name})`,
        performed_by: (req as any).user?.name || 'system',
        transaction_date: txDate,
        theoretical_qty: Number(theoreticalQty.toFixed(4)),
        actual_qty: Number(actualQty.toFixed(4)),
        menu_item_id,
        recipe_id: recipe.id,
      });
      batchProductsConsumed.push(subRecipe.name);
      continue;
    }

    // Normal ingredient line
    const ingredientName = ing?.name || 'Unknown';
    const invItem = invMap.get(ingredientName.toLowerCase());

    if (!invItem) {
      unmatched.push(ingredientName);
      continue;
    }

    const theoreticalQty = Number(rl.quantity || 0) * multiplier;
    const actualQty = actualMap.has(ing?.id) ? actualMap.get(ing?.id)! : theoreticalQty;
    const unitCost = Number(invItem.unit_cost || 0);

    transactions.push({
      item_id: invItem.id,
      transaction_type: 'consumption',
      quantity: actualQty,
      unit_cost: unitCost,
      total_cost: actualQty * unitCost,
      from_outlet_id: outlet_id,
      reason: `Consumption for ${servings_sold} servings`,
      performed_by: (req as any).user?.name || 'system',
      transaction_date: txDate,
      theoretical_qty: Number(theoreticalQty.toFixed(4)),
      actual_qty: Number(actualQty.toFixed(4)),
      menu_item_id,
      recipe_id: recipe.id,
    });
  }

  if (transactions.length === 0) {
    return res.status(400).json({
      error: 'No recipe lines could be matched to inventory items',
      unmatched_ingredients: unmatched,
    });
  }

  // 5. Insert all transactions
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('inventory_transactions')
    .insert(transactions)
    .select();
  if (insertError) return res.status(500).json({ error: insertError.message });

  // 6. Dual-write to unified uinv_* system so dynamic par + replenishment see F&B consumption
  const fbStoreId = await resolveFbStoreForOutlet(outlet_id);
  const performedBy = (req as any).user?.name || 'system';
  const consumptionRef = `FB-CON-${Date.now().toString().slice(-6)}`;
  const dualWriteResult: DualWriteResult = emptyResult();
  for (const tx of inserted) {
    await consumeLegacyItemToUnified({
      propertyId: null,
      legacyItemId: tx.item_id,
      legacyItemName: '', // resolved internally via the FK / name fallback
      storeId: fbStoreId,
      qty: Number(tx.quantity || 0),
      unitCost: Number(tx.unit_cost || 0),
      reference: consumptionRef,
      reason: tx.reason || `F&B consumption: ${servings_sold} servings`,
      performedBy,
      txDate,
      result: dualWriteResult,
    });
  }

  return res.status(201).json({
    success: true,
    transactions_created: inserted.length,
    menu_item_id,
    servings_sold,
    unmatched_ingredients: unmatched,
    batch_products_consumed: batchProductsConsumed,
    transactions: inserted,
    dual_write: {
      unified_successes: dualWriteResult.successes,
      unified_failures: dualWriteResult.failures,
    },
  });
});

// ════════════════════════════════════════════════════════════════════════
// STOCK COUNT — DEPRECATED: use /api/uinv-portal/counts
// STOCK COUNT — submit physical count for multiple items at once.
//
// Body: {
//   outlet_id: string,
//   count_type: 'stock_count' | 'cycle_count',
//   counts: [{ item_id, counted_qty, reason? }]
// }
//
// For each item:
//   - Creates a stock_count/cycle_count transaction recording the variance
//   - Updates inventory_items.current_quantity to the counted value
// ════════════════════════════════════════════════════════════════════════
router.post('/stock-count', deprecatedStockEndpoint, authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { outlet_id, count_type, counts } = req.body;

  if (!outlet_id) return res.status(400).json({ error: 'outlet_id is required' });
  if (!counts || !Array.isArray(counts) || counts.length === 0) {
    return res.status(400).json({ error: 'counts array is required' });
  }
  const txType = count_type === 'cycle_count' ? 'cycle_count' : 'stock_count';
  const txDate = new Date().toISOString();
  const performedBy = (req as any).user?.name || 'system';

  // Fetch current stock for all items in the count
  const itemIds = counts.map((c: any) => c.item_id).filter(Boolean);
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, current_quantity, unit_cost, unit_of_measure')
    .in('id', itemIds);
  if (itemsErr) return res.status(500).json({ error: itemsErr.message });

  const itemMap = new Map<string, any>();
  for (const it of (items || [])) itemMap.set(it.id, it);

  const transactions: any[] = [];
  const updates: any[] = [];
  const results: any[] = [];

  for (const c of counts) {
    const item = itemMap.get(c.item_id);
    if (!item) {
      results.push({ item_id: c.item_id, status: 'not_found' });
      continue;
    }
    const systemQty = Number(item.current_quantity || 0);
    const countedQty = Number(c.counted_qty || 0);
    const variance = countedQty - systemQty;
    const unitCost = Number(item.unit_cost || 0);

    // Create a stock_count transaction recording the variance
    transactions.push({
      item_id: c.item_id,
      transaction_type: txType,
      quantity: Math.abs(variance),
      unit_cost: unitCost,
      total_cost: Math.abs(variance) * unitCost,
      from_outlet_id: variance < 0 ? outlet_id : undefined,
      to_outlet_id: variance >= 0 ? outlet_id : undefined,
      reason: c.reason || `Stock count: system=${systemQty}, counted=${countedQty}, variance=${variance}`,
      performed_by: performedBy,
      transaction_date: txDate,
    });

    // Update the item's current_quantity to the counted value
    updates.push({
      id: c.item_id,
      current_quantity: countedQty,
    });

    results.push({
      item_id: c.item_id,
      item_name: item.name,
      system_qty: systemQty,
      counted_qty: countedQty,
      variance,
      unit: item.unit_of_measure,
      status: 'updated',
    });
  }

  // Insert transactions
  if (transactions.length > 0) {
    const { error: txErr } = await supabaseAdmin
      .from('inventory_transactions')
      .insert(transactions);
    if (txErr) return res.status(500).json({ error: txErr.message });
  }

  // Update inventory items
  for (const u of updates) {
    await supabaseAdmin
      .from('inventory_items')
      .update({ current_quantity: u.current_quantity, updated_at: txDate })
      .eq('id', u.id);
  }

  return res.status(201).json({
    count_type: txType,
    outlet_id,
    items_counted: results.filter(r => r.status === 'updated').length,
    items_not_found: results.filter(r => r.status === 'not_found').length,
    results,
  });
});

router.delete('/transactions/:id', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { error } = await supabaseAdmin.from('inventory_transactions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// INVENTORY REQUISITIONS — DEPRECATED: use /api/uinv-portal/issues
// INVENTORY REQUISITIONS (F&B Inventory Coordination)
// Uses inventory_requisitions + inventory_requisition_lines tables which
// reference inventory_items (parallel to the requisitions/requisition_lines
// tables that reference ingredients).
// ════════════════════════════════════════════════════════════════════════
router.get('/requisitions', deprecatedStockEndpoint, authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { status } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('inventory_requisitions')
    .select('*, lines:inventory_requisition_lines(*)')
    .eq('department', 'F&B')
    .order('request_date', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // Normalize to the shape the InventoryCoordination component expects:
  // { id, requisition_number, requested_by, request_date, from_location, to_location, status, total_cost, items[] }
  const normalized = (data || []).map((r: any) => ({
    id: r.id,
    requisition_number: r.number,
    requested_by: r.requested_by,
    request_date: r.request_date ? String(r.request_date).slice(0, 10) : '',
    from_location: r.from_location,
    to_location: r.to_location,
    status: r.status,
    total_cost: Number(r.total_cost || 0),
    notes: r.notes,
    items: (r.lines || []).map((l: any) => ({
      id: l.id,
      item_id: l.item_id,
      item_name: l.item_name,
      requested_quantity: Number(l.requested_quantity || 0),
      approved_quantity: l.approved_quantity === null ? null : Number(l.approved_quantity),
      unit: l.unit,
      unit_cost: Number(l.unit_cost || 0),
      reason: l.reason,
    })),
  }));
  return res.json(normalized);
});

router.post('/requisitions', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { requisition_number, requested_by, from_location, to_location, notes, items } = req.body;
  if (!requested_by || !to_location) {
    return res.status(400).json({ error: 'requested_by and to_location are required' });
  }
  // Generate a unique requisition number if not provided
  const number = requisition_number || `REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const total_cost = (items || []).reduce((sum: number, it: any) => sum + Number(it.requested_quantity || 0) * Number(it.unit_cost || 0), 0);

  const { data: reqData, error: reqError } = await supabaseAdmin
    .from('inventory_requisitions')
    .insert({
      number,
      department: 'F&B',
      requested_by,
      request_date: new Date().toISOString().slice(0, 10),
      priority: 'Normal',
      status: 'pending',
      from_location: from_location || 'Main Store',
      to_location,
      total_cost,
      notes: notes || null,
      items: '[]',
    })
    .select()
    .single();
  if (reqError) return res.status(500).json({ error: reqError.message });

  if (items && items.length > 0) {
    const lines = items.map((it: any) => ({
      requisition_id: reqData.id,
      item_id: it.item_id,
      item_name: it.item_name,
      requested_quantity: Number(it.requested_quantity || 0),
      unit: it.unit || 'PCS',
      unit_cost: Number(it.unit_cost || 0),
      reason: it.reason || null,
    }));
    const { error: linesError } = await supabaseAdmin.from('inventory_requisition_lines').insert(lines);
    if (linesError) return res.status(500).json({ error: linesError.message });
  }

  return res.status(201).json({
    id: reqData.id,
    requisition_number: reqData.number,
    requested_by: reqData.requested_by,
    request_date: String(reqData.request_date).slice(0, 10),
    from_location: reqData.from_location,
    to_location: reqData.to_location,
    status: reqData.status,
    total_cost: Number(reqData.total_cost || 0),
    notes: reqData.notes,
    items: items || [],
  });
});

router.put('/requisitions/:id/approve', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { approvedQuantities } = req.body as { approvedQuantities?: { id: string; approved_quantity: number }[] };
  const { data, error } = await supabaseAdmin
    .from('inventory_requisitions')
    .update({ status: 'approved' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  if (approvedQuantities && approvedQuantities.length > 0) {
    for (const aq of approvedQuantities) {
      await supabaseAdmin
        .from('inventory_requisition_lines')
        .update({ approved_quantity: Number(aq.approved_quantity) })
        .eq('id', aq.id);
    }
  }
  return res.json({ success: true, id: data.id, status: data.status });
});

router.put('/requisitions/:id/complete', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('inventory_requisitions')
    .update({ status: 'completed' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: data.id, status: data.status });
});

router.put('/requisitions/:id/reject', authenticate, requirePermission('fb:write'), async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { data, error } = await supabaseAdmin
    .from('inventory_requisitions')
    .update({ status: 'rejected' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, id: data.id, status: data.status });
});

// ════════════════════════════════════════════════════════════════════════
// VARIANCE ANALYSIS (computed from inventory_transactions)
// Aggregates consumption + adjustment transactions that carry theoretical_qty
// and actual_qty, grouped by item, and classifies variance severity.
// ════════════════════════════════════════════════════════════════════════
router.get('/variance', authenticate, async (req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  const { startDate, endDate } = req.query as Record<string, string>;
  let q = supabaseAdmin
    .from('inventory_transactions')
    .select('*, item:inventory_items(*), from_outlet:outlets!from_outlet_id(*), to_outlet:outlets!to_outlet_id(*)')
    .in('transaction_type', ['consumption', 'adjustment'])
    .order('transaction_date', { ascending: false });
  if (startDate) q = q.gte('transaction_date', startDate);
  if (endDate) q = q.lte('transaction_date', endDate);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).filter((t: any) => Number(t.theoretical_qty || 0) > 0 || Number(t.actual_qty || 0) > 0);
  // Per-transaction variance records
  // When theoretical_qty = 0, there is no baseline to compare against, so
  // variance_percent is null (displayed as "N/A") rather than falsely 0%.
  const records = rows.map((t: any) => {
    const theoretical = Number(t.theoretical_qty || 0);
    const actual = Number(t.actual_qty || 0);
    const varianceQty = actual - theoretical;
    const hasBaseline = theoretical !== 0;
    const variancePercent = hasBaseline ? (varianceQty / theoretical) * 100 : null;
    const unitCost = Number(t.item?.unit_cost || t.unit_cost || 0);
    return {
      id: t.id,
      date: t.transaction_date ? String(t.transaction_date).slice(0, 10) : '',
      outlet_id: t.from_outlet_id || t.to_outlet_id || '',
      outlet_name: t.from_outlet?.name || t.to_outlet?.name || '',
      item_id: t.item_id,
      item_name: t.item?.name || '',
      category: t.item?.category_id || '',
      theoretical_qty: theoretical,
      actual_qty: actual,
      variance_qty: varianceQty,
      variance_percent: variancePercent === null ? null : Number(variancePercent.toFixed(2)),
      unit: t.item?.unit_of_measure || 'PCS',
      unit_cost: unitCost,
      cost: Number(t.total_cost || 0),
      theoretical_cost: Number((theoretical * unitCost).toFixed(2)),
      actual_cost: Number((actual * unitCost).toFixed(2)),
      variance_cost: Number(((actual - theoretical) * unitCost).toFixed(2)),
    };
  });

  // Per-item aggregation
  const byItem = new Map<string, any>();
  for (const r of records) {
    const key = r.item_id;
    if (!byItem.has(key)) {
      byItem.set(key, {
        item_id: r.item_id,
        item_name: r.item_name,
        category: r.category,
        theoretical_total: 0,
        actual_total: 0,
        unit: r.unit,
        unit_cost: r.unit_cost,
        records: 0,
      });
    }
    const agg = byItem.get(key);
    agg.theoretical_total += r.theoretical_qty;
    agg.actual_total += r.actual_qty;
    agg.records += 1;
  }
  const aggregated = Array.from(byItem.values()).map((a: any) => {
    const varianceQty = a.actual_total - a.theoretical_total;
    const hasBaseline = a.theoretical_total !== 0;
    const variancePercent = hasBaseline ? (varianceQty / a.theoretical_total) * 100 : null;
    const theoreticalCost = Number((a.theoretical_total * a.unit_cost).toFixed(2));
    const actualCost = Number((a.actual_total * a.unit_cost).toFixed(2));
    const varianceCost = Number((actualCost - theoreticalCost).toFixed(2));
    // Only classify severity when a baseline exists. Items without a baseline
    // get severity 'na' and are excluded from high/medium/low counts.
    const severity = !hasBaseline ? 'na'
      : Math.abs(variancePercent) >= 10 ? 'high'
      : Math.abs(variancePercent) >= 5 ? 'medium'
      : 'low';
    return {
      item_id: a.item_id,
      item_name: a.item_name,
      category: a.category,
      theoretical: Number(a.theoretical_total.toFixed(2)),
      actual: Number(a.actual_total.toFixed(2)),
      variance_qty: Number(varianceQty.toFixed(2)),
      variance_percent: variancePercent === null ? null : Number(variancePercent.toFixed(2)),
      unit: a.unit,
      unit_cost: a.unit_cost,
      theoretical_cost: theoreticalCost,
      actual_cost: actualCost,
      variance_cost: varianceCost,
      records: a.records,
      severity,
    };
  });

  const high = aggregated.filter((a: any) => a.severity === 'high').length;
  const medium = aggregated.filter((a: any) => a.severity === 'medium').length;
  const low = aggregated.filter((a: any) => a.severity === 'low').length;
  const na = aggregated.filter((a: any) => a.severity === 'na').length;
  const totalVarianceCost = aggregated.reduce((s: number, a: any) => s + a.variance_cost, 0);

  return res.json({
    records,
    aggregated,
    summary: { high, medium, low, na, total: aggregated.length, total_variance_cost: Number(totalVarianceCost.toFixed(2)) },
  });
});

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD/ANALYTICS ENDPOINTS — DEPRECATED: use /api/uinv-portal/dashboard or /api/uinv-portal/valuation
// ════════════════════════════════════════════════════════════════════════
router.get('/analytics/summary', deprecatedStockEndpoint, authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  // Get inventory summary by category
  const { data: categories } = await supabaseAdmin
    .from('inventory_items')
    .select('category_id, category:inventory_categories(name)')
    .not('is_eq', 'current_quantity', 0);
  
  const categorySummary = categories.reduce((acc: any, item: any) => {
    if (!acc[item.category]) {
      acc[item.category] = { count: 0, totalValue: 0 };
    }
    acc[item.category].count += 1;
    acc[item.category].totalValue += item.total_value || 0;
    return acc;
  }, {});
  
  // Get low stock items
  const { data: lowStockItems } = await supabaseAdmin
    .from('inventory_items')
    .select('*')
    .lte('current_quantity', 'reorder_point')
    .order('current_quantity', { ascending: true });
  
  // Get total inventory value
  const { data: totalValue } = await supabaseAdmin
    .from('inventory_items')
    .select('total_value');
  
  const totalInventoryValue = totalValue.reduce((sum: number, item: any) => sum + (item.total_value || 0), 0);
  
  return res.json({
    totalValue: totalInventoryValue,
    categorySummary,
    lowStockItems: lowStockItems || [],
    lowStockCount: lowStockItems?.length || 0
  });
});

router.get('/analytics/cost-control', authenticate, async (_req, res) => {
  if (!hasSupabaseAdminConfig || !supabaseAdmin) return dbNotConfigured(res);
  
  // This is a placeholder - actual cost control calculations would come from recipe data
  // For now, return mock data structure
  return res.json({
    foodCostPercent: 32.5,
    beverageCostPercent: 28.5,
    contributionMargin: 66.4,
    grossMargin: 66.4,
    purchasePriceVariance: 2.3,
    productionVariance: 1.8,
    consumptionVariance: 3.1,
    dailyProfitability: {
      revenue: 12500,
      cogs: 4200,
      grossMargin: 66.4,
      netProfit: 8300
    }
  });
});

export default router;