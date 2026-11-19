/**
 * Seed F&B Recipe Management sample data
 * Run: npx tsx scripts/seed-fb-recipes.ts
 *
 * Inserts sample: ingredients, recipes, recipe_lines
 * Links recipes to existing menu items seeded by seed-fb-menu-catalog.ts
 */
import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function seedRecipes() {
  // ── 1. Load menu items (need IDs to link recipes) ────────────────────
  const { data: menuItems } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, item_code, selling_price')
    .order('name');
  if (!menuItems || menuItems.length === 0) {
    console.error('[SEED] No menu items found. Run seed-fb-menu-catalog.ts first.');
    process.exit(1);
  }
  const itemByCode: Record<string, { id: string; name: string; price: number }> = {};
  for (const mi of menuItems) {
    if (mi.item_code) itemByCode[mi.item_code] = { id: mi.id, name: mi.name, price: Number(mi.selling_price) };
  }

  // ── 2. Ingredients ───────────────────────────────────────────────────
  const ingredientDefs = [
    // Food — Produce
    { name: 'Tomato', category: 'Food', unit: 'kg', cost: 3.50, par: 20, reorder: 10, suppliers: ['FreshCo'] },
    { name: 'Fresh Basil', category: 'Food', unit: 'bunch', cost: 1.20, par: 10, reorder: 5, suppliers: ['FreshCo'] },
    { name: 'Mozzarella Cheese', category: 'Food', unit: 'kg', cost: 8.00, par: 15, reorder: 8, suppliers: ['DairyPlus'] },
    { name: 'Pizza Dough', category: 'Food', unit: 'kg', cost: 4.00, par: 10, reorder: 5, suppliers: ['BakeryHub'] },
    { name: 'Olive Oil', category: 'Food', unit: 'L', cost: 12.00, par: 10, reorder: 5, suppliers: ['Mediterra'] },
    { name: 'Romaine Lettuce', category: 'Food', unit: 'kg', cost: 4.00, par: 8, reorder: 4, suppliers: ['FreshCo'] },
    { name: 'Parmesan Cheese', category: 'Food', unit: 'kg', cost: 18.00, par: 5, reorder: 3, suppliers: ['DairyPlus'] },
    { name: 'Croutons', category: 'Food', unit: 'kg', cost: 6.00, par: 3, reorder: 2, suppliers: ['BakeryHub'] },
    { name: 'Caesar Dressing', category: 'Food', unit: 'L', cost: 9.00, par: 5, reorder: 3, suppliers: ['SauceCo'] },
    // Food — Meat & Seafood
    { name: 'Salmon Fillet', category: 'Food', unit: 'kg', cost: 28.00, par: 12, reorder: 6, suppliers: ['OceanFresh'] },
    { name: 'Beef Tenderloin', category: 'Food', unit: 'kg', cost: 45.00, par: 10, reorder: 5, suppliers: ['PrimeMeat'] },
    { name: 'Bacon Strips', category: 'Food', unit: 'kg', cost: 16.00, par: 8, reorder: 4, suppliers: ['PrimeMeat'] },
    { name: 'Turkey Breast', category: 'Food', unit: 'kg', cost: 14.00, par: 6, reorder: 3, suppliers: ['PrimeMeat'] },
    // Food — Dairy & Eggs
    { name: 'Eggs', category: 'Food', unit: 'dozen', cost: 3.00, par: 20, reorder: 10, suppliers: ['DairyPlus'] },
    { name: 'Heavy Cream', category: 'Food', unit: 'L', cost: 4.50, par: 8, reorder: 4, suppliers: ['DairyPlus'] },
    { name: 'Mascarpone Cheese', category: 'Food', unit: 'kg', cost: 22.00, par: 4, reorder: 2, suppliers: ['DairyPlus'] },
    { name: 'Gruyère Cheese', category: 'Food', unit: 'kg', cost: 25.00, par: 3, reorder: 2, suppliers: ['DairyPlus'] },
    // Food — Dry Goods
    { name: 'All-Purpose Flour', category: 'Food', unit: 'kg', cost: 1.50, par: 25, reorder: 10, suppliers: ['DryGoodsCo'] },
    { name: 'Spaghetti Pasta', category: 'Food', unit: 'kg', cost: 2.50, par: 15, reorder: 8, suppliers: ['DryGoodsCo'] },
    { name: 'Sugar', category: 'Food', unit: 'kg', cost: 1.20, par: 20, reorder: 10, suppliers: ['DryGoodsCo'] },
    { name: 'Salt', category: 'Spice', unit: 'kg', cost: 0.80, par: 10, reorder: 5, suppliers: ['DryGoodsCo'] },
    { name: 'Black Pepper', category: 'Spice', unit: 'kg', cost: 12.00, par: 2, reorder: 1, suppliers: ['SpiceWorld'] },
    { name: 'Garlic', category: 'Food', unit: 'kg', cost: 5.00, par: 5, reorder: 3, suppliers: ['FreshCo'] },
    { name: 'Onions', category: 'Food', unit: 'kg', cost: 1.80, par: 15, reorder: 8, suppliers: ['FreshCo'] },
    { name: 'Beef Broth', category: 'Food', unit: 'L', cost: 3.50, par: 10, reorder: 5, suppliers: ['SauceCo'] },
    // Food — Pancetta & Coffee
    { name: 'Pancetta', category: 'Food', unit: 'kg', cost: 18.00, par: 5, reorder: 3, suppliers: ['PrimeMeat'] },
    { name: 'Espresso Beans', category: 'Beverage', unit: 'kg', cost: 20.00, par: 5, reorder: 3, suppliers: ['CoffeeRoasters'] },
    { name: 'Coffee Liqueur', category: 'Beverage', unit: 'L', cost: 18.00, par: 5, reorder: 3, suppliers: ['BevDist'] },
    // Bar
    { name: 'White Rum', category: 'Beverage', unit: 'L', cost: 16.00, par: 10, reorder: 5, suppliers: ['BevDist'] },
    { name: 'Bourbon Whiskey', category: 'Beverage', unit: 'L', cost: 28.00, par: 8, reorder: 4, suppliers: ['BevDist'] },
    { name: 'Vodka', category: 'Beverage', unit: 'L', cost: 18.00, par: 8, reorder: 4, suppliers: ['BevDist'] },
    { name: 'Lime', category: 'Food', unit: 'kg', cost: 3.00, par: 10, reorder: 5, suppliers: ['FreshCo'] },
    { name: 'Mint Leaves', category: 'Food', unit: 'bunch', cost: 1.00, par: 10, reorder: 5, suppliers: ['FreshCo'] },
    { name: 'Soda Water', category: 'Beverage', unit: 'L', cost: 1.50, par: 20, reorder: 10, suppliers: ['BevDist'] },
    { name: 'Simple Syrup', category: 'Beverage', unit: 'L', cost: 3.00, par: 5, reorder: 3, suppliers: ['BevDist'] },
    { name: 'Angostura Bitters', category: 'Beverage', unit: 'ml', cost: 0.05, par: 500, reorder: 200, suppliers: ['BevDist'] },
    { name: 'Orange Peel', category: 'Food', unit: 'piece', cost: 0.10, par: 50, reorder: 20, suppliers: ['FreshCo'] },
    // Calamari
    { name: 'Calamari', category: 'Food', unit: 'kg', cost: 14.00, par: 8, reorder: 4, suppliers: ['OceanFresh'] },
    { name: 'Frying Oil', category: 'Food', unit: 'L', cost: 2.50, par: 20, reorder: 10, suppliers: ['DryGoodsCo'] },
    { name: 'Aioli Sauce', category: 'Food', unit: 'L', cost: 7.00, par: 5, reorder: 3, suppliers: ['SauceCo'] },
    // Sandwich & Burger
    { name: 'Bread Loaf', category: 'Food', unit: 'loaf', cost: 2.50, par: 15, reorder: 8, suppliers: ['BakeryHub'] },
    { name: 'Cheddar Cheese', category: 'Food', unit: 'kg', cost: 12.00, par: 8, reorder: 4, suppliers: ['DairyPlus'] },
    { name: 'Beef Patty', category: 'Food', unit: 'piece', cost: 3.50, par: 30, reorder: 15, suppliers: ['PrimeMeat'] },
    { name: 'Potato', category: 'Food', unit: 'kg', cost: 1.50, par: 20, reorder: 10, suppliers: ['FreshCo'] },
    { name: 'Lettuce', category: 'Food', unit: 'head', cost: 1.20, par: 15, reorder: 8, suppliers: ['FreshCo'] },
    { name: 'Tomato Slice', category: 'Food', unit: 'piece', cost: 0.15, par: 50, reorder: 20, suppliers: ['FreshCo'] },
    // Breakfast
    { name: 'Croissant', category: 'Food', unit: 'piece', cost: 1.50, par: 20, reorder: 10, suppliers: ['BakeryHub'] },
    { name: 'Strawberry Jam', category: 'Food', unit: 'kg', cost: 6.00, par: 5, reorder: 3, suppliers: ['PreserveCo'] },
    { name: 'Fresh Fruit Mix', category: 'Food', unit: 'kg', cost: 5.00, par: 8, reorder: 4, suppliers: ['FreshCo'] },
    { name: 'Orange Juice', category: 'Beverage', unit: 'L', cost: 4.00, par: 10, reorder: 5, suppliers: ['FreshCo'] },
    { name: 'Coffee Beans', category: 'Beverage', unit: 'kg', cost: 18.00, par: 5, reorder: 3, suppliers: ['CoffeeRoasters'] },
    { name: 'Lemon', category: 'Food', unit: 'kg', cost: 3.50, par: 10, reorder: 5, suppliers: ['FreshCo'] },
    { name: 'Butter', category: 'Food', unit: 'kg', cost: 8.50, par: 8, reorder: 4, suppliers: ['DairyPlus'] },
    { name: 'Mayonnaise', category: 'Food', unit: 'L', cost: 5.00, par: 5, reorder: 3, suppliers: ['SauceCo'] },
  ];

  const ingIdByName: Record<string, string> = {};
  let ingCount = 0;
  for (const ing of ingredientDefs) {
    const { data: existing } = await supabaseAdmin.from('ingredients').select('id').eq('name', ing.name).maybeSingle();
    if (existing) { ingIdByName[ing.name] = existing.id; continue; }
    const { data, error } = await supabaseAdmin.from('ingredients').insert({
      name: ing.name,
      category: ing.category,
      unit_of_measure: ing.unit,
      par_level: ing.par,
      reorder_point: ing.reorder,
      current_cost: ing.cost,
      suppliers: ing.suppliers,
      is_active: true
    }).select().single();
    if (error) { console.error('[SEED] ingredient', ing.name, error.message); continue; }
    ingIdByName[ing.name] = data.id;
    ingCount++;
  }
  console.log(`[SEED] Ingredients: ${ingCount} new (${Object.keys(ingIdByName).length} total)`);

  // ── 3. Recipes + Recipe Lines ────────────────────────────────────────
  const recipeDefs = [
    {
      itemCode: 'LM-001', yield: 0.95, portions: 1,
      lines: [
        { ing: 'Pizza Dough', qty: 0.25, unit: 'kg' },
        { ing: 'Tomato', qty: 0.15, unit: 'kg' },
        { ing: 'Mozzarella Cheese', qty: 0.10, unit: 'kg' },
        { ing: 'Fresh Basil', qty: 0.02, unit: 'bunch' },
        { ing: 'Olive Oil', qty: 0.02, unit: 'L' },
        { ing: 'Salt', qty: 0.005, unit: 'kg' },
      ]
    },
    {
      itemCode: 'LM-002', yield: 0.90, portions: 1,
      lines: [
        { ing: 'Salmon Fillet', qty: 0.18, unit: 'kg' },
        { ing: 'Olive Oil', qty: 0.03, unit: 'L' },
        { ing: 'Salt', qty: 0.003, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.002, unit: 'kg' },
        { ing: 'Lemon', qty: 0.05, unit: 'kg' },
      ]
    },
    {
      itemCode: 'LM-003', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Romaine Lettuce', qty: 0.15, unit: 'kg' },
        { ing: 'Croutons', qty: 0.03, unit: 'kg' },
        { ing: 'Parmesan Cheese', qty: 0.02, unit: 'kg' },
        { ing: 'Caesar Dressing', qty: 0.04, unit: 'L' },
        { ing: 'Black Pepper', qty: 0.001, unit: 'kg' },
      ]
    },
    {
      itemCode: 'LM-004', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Mascarpone Cheese', qty: 0.05, unit: 'kg' },
        { ing: 'Eggs', qty: 0.08, unit: 'dozen' },
        { ing: 'Sugar', qty: 0.02, unit: 'kg' },
        { ing: 'Espresso Beans', qty: 0.01, unit: 'kg' },
        { ing: 'All-Purpose Flour', qty: 0.01, unit: 'kg' },
      ]
    },
    {
      itemCode: 'LM-005', yield: 0.98, portions: 1,
      lines: [
        { ing: 'Onions', qty: 0.20, unit: 'kg' },
        { ing: 'Beef Broth', qty: 0.30, unit: 'L' },
        { ing: 'Gruyère Cheese', qty: 0.04, unit: 'kg' },
        { ing: 'Bread Loaf', qty: 0.03, unit: 'loaf' },
        { ing: 'Butter', qty: 0.02, unit: 'kg' },
        { ing: 'Garlic', qty: 0.005, unit: 'kg' },
      ]
    },
    {
      itemCode: 'LM-006', yield: 0.92, portions: 1,
      lines: [
        { ing: 'Beef Tenderloin', qty: 0.23, unit: 'kg' },
        { ing: 'Salt', qty: 0.003, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.002, unit: 'kg' },
        { ing: 'Olive Oil', qty: 0.02, unit: 'L' },
        { ing: 'Butter', qty: 0.03, unit: 'kg' },
        { ing: 'Garlic', qty: 0.005, unit: 'kg' },
      ]
    },
    {
      itemCode: 'SL-001', yield: 1.00, portions: 1,
      lines: [
        { ing: 'White Rum', qty: 0.05, unit: 'L' },
        { ing: 'Lime', qty: 0.03, unit: 'kg' },
        { ing: 'Mint Leaves', qty: 0.01, unit: 'bunch' },
        { ing: 'Simple Syrup', qty: 0.02, unit: 'L' },
        { ing: 'Soda Water', qty: 0.10, unit: 'L' },
      ]
    },
    {
      itemCode: 'SL-002', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Bourbon Whiskey', qty: 0.06, unit: 'L' },
        { ing: 'Simple Syrup', qty: 0.01, unit: 'L' },
        { ing: 'Angostura Bitters', qty: 3, unit: 'ml' },
        { ing: 'Orange Peel', qty: 1, unit: 'piece' },
      ]
    },
    {
      itemCode: 'SL-003', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Vodka', qty: 0.05, unit: 'L' },
        { ing: 'Coffee Liqueur', qty: 0.03, unit: 'L' },
        { ing: 'Espresso Beans', qty: 0.01, unit: 'kg' },
        { ing: 'Simple Syrup', qty: 0.01, unit: 'L' },
      ]
    },
    {
      itemCode: 'SL-004', yield: 0.85, portions: 1,
      lines: [
        { ing: 'Calamari', qty: 0.15, unit: 'kg' },
        { ing: 'All-Purpose Flour', qty: 0.05, unit: 'kg' },
        { ing: 'Frying Oil', qty: 0.10, unit: 'L' },
        { ing: 'Aioli Sauce', qty: 0.03, unit: 'L' },
        { ing: 'Salt', qty: 0.003, unit: 'kg' },
      ]
    },
    {
      itemCode: 'RS-001', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Bread Loaf', qty: 0.08, unit: 'loaf' },
        { ing: 'Turkey Breast', qty: 0.08, unit: 'kg' },
        { ing: 'Bacon Strips', qty: 0.03, unit: 'kg' },
        { ing: 'Lettuce', qty: 0.02, unit: 'head' },
        { ing: 'Tomato Slice', qty: 2, unit: 'piece' },
        { ing: 'Mayonnaise', qty: 0.02, unit: 'L' },
      ]
    },
    {
      itemCode: 'RS-002', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Croissant', qty: 1, unit: 'piece' },
        { ing: 'Strawberry Jam', qty: 0.03, unit: 'kg' },
        { ing: 'Fresh Fruit Mix', qty: 0.10, unit: 'kg' },
        { ing: 'Orange Juice', qty: 0.20, unit: 'L' },
        { ing: 'Coffee Beans', qty: 0.01, unit: 'kg' },
      ]
    },
    {
      itemCode: 'RS-003', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Beef Patty', qty: 1, unit: 'piece' },
        { ing: 'Cheddar Cheese', qty: 0.03, unit: 'kg' },
        { ing: 'Bread Loaf', qty: 0.05, unit: 'loaf' },
        { ing: 'Lettuce', qty: 0.02, unit: 'head' },
        { ing: 'Tomato Slice', qty: 1, unit: 'piece' },
        { ing: 'Potato', qty: 0.20, unit: 'kg' },
        { ing: 'Frying Oil', qty: 0.05, unit: 'L' },
        { ing: 'Salt', qty: 0.003, unit: 'kg' },
      ]
    },
    {
      itemCode: 'RS-004', yield: 1.00, portions: 1,
      lines: [
        { ing: 'Spaghetti Pasta', qty: 0.12, unit: 'kg' },
        { ing: 'Pancetta', qty: 0.05, unit: 'kg' },
        { ing: 'Eggs', qty: 0.08, unit: 'dozen' },
        { ing: 'Parmesan Cheese', qty: 0.03, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.002, unit: 'kg' },
      ]
    },
  ];

  let recipeCount = 0, lineCount = 0;
  for (const rd of recipeDefs) {
    const mi = itemByCode[rd.itemCode];
    if (!mi) { console.warn(`[SEED] Menu item ${rd.itemCode} not found, skipping`); continue; }

    // Check if recipe already exists for this menu item
    const { data: existing } = await supabaseAdmin.from('recipes').select('id').eq('menu_item_id', mi.id).maybeSingle();
    let recipeId = existing?.id;
    if (!recipeId) {
      const { data, error } = await supabaseAdmin.from('recipes').insert({
        menu_item_id: mi.id, yield: rd.yield, portions: rd.portions
      }).select().single();
      if (error) { console.error('[SEED] recipe', rd.itemCode, error.message); continue; }
      recipeId = data.id;
      recipeCount++;
    }

    // Insert recipe lines
    for (const line of rd.lines) {
      const ingId = ingIdByName[line.ing];
      if (!ingId) { console.warn(`[SEED] Ingredient "${line.ing}" not found`); continue; }

      // Check if line already exists
      const { data: lineExisting } = await supabaseAdmin.from('recipe_lines')
        .select('id').eq('recipe_id', recipeId).eq('ingredient_id', ingId).maybeSingle();
      if (lineExisting) continue;

      // Get current cost for cost_at_time_of_costing
      const { data: ing } = await supabaseAdmin.from('ingredients').select('current_cost').eq('id', ingId).single();
      const cost = ing ? Number(ing.current_cost) : 0;

      const { error } = await supabaseAdmin.from('recipe_lines').insert({
        recipe_id: recipeId,
        ingredient_id: ingId,
        quantity: line.qty,
        unit: line.unit,
        cost_at_time_of_costing: cost
      });
      if (error) console.error('[SEED] recipe_line', line.ing, error.message);
      else lineCount++;
    }
  }
  console.log(`[SEED] Recipes: ${recipeCount} new, recipe lines: ${lineCount} new`);

  console.log('\n[DONE] Recipe seed complete.');
}

seedRecipes().catch(err => {
  console.error('[SEED] Unexpected error:', err);
  process.exit(1);
});
