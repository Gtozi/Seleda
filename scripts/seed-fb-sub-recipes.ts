/**
 * Seed F&B Sub-Recipes sample data
 * Run: npx tsx scripts/seed-fb-sub-recipes.ts
 *
 * Inserts sample sub-recipes (intermediate preparations like tomato sauce, pizza dough, etc.)
 * with their own ingredient lines, and links them to existing recipes via recipe_lines.sub_recipe_id.
 */
import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function seedSubRecipes() {
  // ── 1. Load ingredients ───────────────────────────────────────────────
  const { data: ingredients } = await supabaseAdmin.from('ingredients').select('id, name, current_cost, unit_of_measure').order('name');
  if (!ingredients || ingredients.length === 0) {
    console.error('[SEED] No ingredients found. Run seed-fb-recipes.ts first.');
    process.exit(1);
  }
  const ingByName: Record<string, { id: string; cost: number; unit: string }> = {};
  for (const ing of ingredients) {
    ingByName[ing.name] = { id: ing.id, cost: Number(ing.current_cost), unit: ing.unit_of_measure };
  }

  // ── 2. Load menu items & recipes ──────────────────────────────────────
  const { data: recipes } = await supabaseAdmin.from('recipes').select('id, menu_item_id').order('created_at');
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, item_code');
  const itemCodeById: Record<string, string> = {};
  for (const mi of menuItems || []) {
    if (mi.item_code) itemCodeById[mi.id] = mi.item_code;
  }
  const recipeByItemCode: Record<string, string> = {};
  for (const r of recipes || []) {
    const code = itemCodeById[r.menu_item_id];
    if (code) recipeByItemCode[code] = r.id;
  }

  // ── 3. Sub-Recipe Definitions ─────────────────────────────────────────
  const subRecipeDefs = [
    {
      name: 'Tomato Sauce',
      description: 'Classic Italian tomato sauce with garlic and basil',
      category: 'Sauce',
      yieldQty: 2.0, yieldUnit: 'kg', portions: 10,
      prepTime: 10, cookTime: 45, shelfLife: 72, storageTemp: 'Refrigerated', haccp: 'Core Temp',
      lines: [
        { ing: 'Tomato', qty: 1.5, unit: 'kg' },
        { ing: 'Onions', qty: 0.2, unit: 'kg' },
        { ing: 'Garlic', qty: 0.03, unit: 'kg' },
        { ing: 'Olive Oil', qty: 0.05, unit: 'L' },
        { ing: 'Fresh Basil', qty: 0.05, unit: 'bunch' },
        { ing: 'Salt', qty: 0.01, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.002, unit: 'kg' },
      ],
      usedInRecipes: ['LM-001'], // Margherita Pizza
    },
    {
      name: 'Pizza Dough',
      description: 'Basic pizza dough with flour, yeast, water, and salt',
      category: 'Dough',
      yieldQty: 1.5, yieldUnit: 'kg', portions: 6,
      prepTime: 15, cookTime: 0, shelfLife: 24, storageTemp: 'Refrigerated', haccp: 'Cold Chain',
      lines: [
        { ing: 'All-Purpose Flour', qty: 1.0, unit: 'kg' },
        { ing: 'Salt', qty: 0.015, unit: 'kg' },
        { ing: 'Olive Oil', qty: 0.03, unit: 'L' },
      ],
      usedInRecipes: ['LM-001'], // Margherita Pizza
    },
    {
      name: 'Caesar Dressing',
      description: 'Creamy Caesar dressing with parmesan and garlic',
      category: 'Dressing',
      yieldQty: 0.5, yieldUnit: 'L', portions: 8,
      prepTime: 10, cookTime: 0, shelfLife: 48, storageTemp: 'Refrigerated', haccp: 'Cold Chain',
      lines: [
        { ing: 'Eggs', qty: 0.08, unit: 'dozen' },
        { ing: 'Parmesan Cheese', qty: 0.05, unit: 'kg' },
        { ing: 'Garlic', qty: 0.01, unit: 'kg' },
        { ing: 'Olive Oil', qty: 0.20, unit: 'L' },
        { ing: 'Salt', qty: 0.005, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.002, unit: 'kg' },
      ],
      usedInRecipes: ['LM-003'], // Caesar Salad
    },
    {
      name: 'Beef Stock',
      description: 'Rich beef stock made from bones and aromatics',
      category: 'Stock',
      yieldQty: 3.0, yieldUnit: 'L', portions: 12,
      prepTime: 20, cookTime: 240, shelfLife: 96, storageTemp: 'Refrigerated', haccp: 'Core Temp',
      lines: [
        { ing: 'Beef Broth', qty: 2.0, unit: 'L' },
        { ing: 'Onions', qty: 0.3, unit: 'kg' },
        { ing: 'Garlic', qty: 0.02, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.005, unit: 'kg' },
        { ing: 'Salt', qty: 0.01, unit: 'kg' },
      ],
      usedInRecipes: ['LM-005'], // French Onion Soup
    },
    {
      name: 'Lemon Butter Sauce',
      description: 'Classic lemon butter sauce for seafood dishes',
      category: 'Sauce',
      yieldQty: 0.3, yieldUnit: 'L', portions: 4,
      prepTime: 5, cookTime: 10, shelfLife: 24, storageTemp: 'Refrigerated', haccp: 'Core Temp',
      lines: [
        { ing: 'Butter', qty: 0.15, unit: 'kg' },
        { ing: 'Lemon', qty: 0.10, unit: 'kg' },
        { ing: 'Garlic', qty: 0.01, unit: 'kg' },
        { ing: 'Salt', qty: 0.003, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.001, unit: 'kg' },
      ],
      usedInRecipes: ['LM-002'], // Grilled Salmon
    },
    {
      name: 'Truffle Red Wine Reduction',
      description: 'Rich red wine reduction for steak',
      category: 'Sauce',
      yieldQty: 0.25, yieldUnit: 'L', portions: 4,
      prepTime: 10, cookTime: 30, shelfLife: 48, storageTemp: 'Refrigerated', haccp: 'Core Temp',
      lines: [
        { ing: 'Beef Broth', qty: 0.30, unit: 'L' },
        { ing: 'Butter', qty: 0.05, unit: 'kg' },
        { ing: 'Garlic', qty: 0.01, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.002, unit: 'kg' },
        { ing: 'Salt', qty: 0.003, unit: 'kg' },
      ],
      usedInRecipes: ['LM-006'], // Beef Tenderloin
    },
    {
      name: 'Espresso Syrup',
      description: 'Sweetened espresso syrup for cocktails',
      category: 'Base',
      yieldQty: 0.3, yieldUnit: 'L', portions: 10,
      prepTime: 5, cookTime: 10, shelfLife: 168, storageTemp: 'Refrigerated', haccp: 'Cold Chain',
      lines: [
        { ing: 'Espresso Beans', qty: 0.05, unit: 'kg' },
        { ing: 'Sugar', qty: 0.15, unit: 'kg' },
      ],
      usedInRecipes: ['SL-003'], // Espresso Martini
    },
    {
      name: 'Breading Mix',
      description: 'Seasoned flour breading for fried items',
      category: 'Base',
      yieldQty: 0.5, yieldUnit: 'kg', portions: 8,
      prepTime: 5, cookTime: 0, shelfLife: 720, storageTemp: 'Room Temp', haccp: 'Standard',
      lines: [
        { ing: 'All-Purpose Flour', qty: 0.40, unit: 'kg' },
        { ing: 'Salt', qty: 0.01, unit: 'kg' },
        { ing: 'Black Pepper', qty: 0.005, unit: 'kg' },
        { ing: 'Garlic', qty: 0.005, unit: 'kg' },
      ],
      usedInRecipes: ['SL-004'], // Calamari Fritti
    },
  ];

  // ── 4. Insert sub-recipes + lines ─────────────────────────────────────
  let srCount = 0, lineCount = 0;
  const subRecipeIdByName: Record<string, string> = {};

  for (const sr of subRecipeDefs) {
    // Check if sub-recipe already exists
    const { data: existing } = await supabaseAdmin.from('sub_recipes').select('id').eq('name', sr.name).maybeSingle();
    let srId = existing?.id;
    if (!srId) {
      const { data, error } = await supabaseAdmin.from('sub_recipes').insert({
        name: sr.name,
        description: sr.description,
        category: sr.category,
        yield_qty: sr.yieldQty,
        yield_unit: sr.yieldUnit,
        portions: sr.portions,
        prep_time_minutes: sr.prepTime,
        cook_time_minutes: sr.cookTime,
        shelf_life_hours: sr.shelfLife,
        storage_temp: sr.storageTemp,
        haccp_control: sr.haccp,
        is_active: true,
      }).select().single();
      if (error) { console.error('[SEED] sub_recipe', sr.name, error.message); continue; }
      srId = data.id;
      srCount++;
    }
    subRecipeIdByName[sr.name] = srId;

    // Insert sub-recipe lines
    for (const line of sr.lines) {
      const ing = ingByName[line.ing];
      if (!ing) { console.warn(`[SEED] Ingredient "${line.ing}" not found for ${sr.name}`); continue; }

      const { data: lineExisting } = await supabaseAdmin.from('sub_recipe_lines')
        .select('id').eq('sub_recipe_id', srId).eq('ingredient_id', ing.id).maybeSingle();
      if (lineExisting) continue;

      const { error } = await supabaseAdmin.from('sub_recipe_lines').insert({
        sub_recipe_id: srId,
        ingredient_id: ing.id,
        quantity: line.qty,
        unit: line.unit,
        cost_at_time_of_costing: ing.cost,
      });
      if (error) console.error('[SEED] sub_recipe_line', line.ing, error.message);
      else lineCount++;
    }
  }
  console.log(`[SEED] Sub-recipes: ${srCount} new, lines: ${lineCount} new`);

  // ── 5. Link sub-recipes to recipes via recipe_lines.sub_recipe_id ─────
  let linkCount = 0;
  for (const sr of subRecipeDefs) {
    const srId = subRecipeIdByName[sr.name];
    if (!srId) continue;
    for (const itemCode of sr.usedInRecipes) {
      const recipeId = recipeByItemCode[itemCode];
      if (!recipeId) { console.warn(`[SEED] Recipe for item ${itemCode} not found`); continue; }

      // Check if a recipe_line with this sub_recipe_id already exists
      const { data: existingLink } = await supabaseAdmin.from('recipe_lines')
        .select('id').eq('recipe_id', recipeId).eq('sub_recipe_id', srId).maybeSingle();
      if (existingLink) continue;

      // Insert a recipe_line referencing the sub-recipe (ingredient_id can be null, but the column is NOT NULL)
      // We'll use the first ingredient from the sub-recipe as a proxy ingredient_id, and set sub_recipe_id
      // Actually, ingredient_id is NOT NULL in recipe_lines. We need to pick a representative ingredient.
      // Let's use the first ingredient of the sub-recipe as the ingredient_id and set sub_recipe_id
      const firstLine = sr.lines[0];
      const firstIng = ingByName[firstLine.ing];
      if (!firstIng) continue;

      const { error } = await supabaseAdmin.from('recipe_lines').insert({
        recipe_id: recipeId,
        ingredient_id: firstIng.id,
        quantity: 0, // The sub-recipe itself carries the real quantities
        unit: sr.yieldUnit,
        cost_at_time_of_costing: 0,
        sub_recipe_id: srId,
      });
      if (error) console.error('[SEED] recipe_line link', sr.name, '->', itemCode, error.message);
      else linkCount++;
    }
  }
  console.log(`[SEED] Sub-recipe → recipe links: ${linkCount}`);

  console.log('\n[DONE] Sub-recipe seed complete.');
}

seedSubRecipes().catch(err => {
  console.error('[SEED] Unexpected error:', err);
  process.exit(1);
});
