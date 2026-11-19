import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function main() {
  // Replicate the GET /api/fb/recipes logic
  const { data: recipes, error: rErr } = await supabaseAdmin.from('recipes').select('*').order('created_at', { ascending: false });
  if (rErr) { console.error('recipes err:', rErr); return; }

  const { data: menuItems, error: miErr } = await supabaseAdmin.from('menu_items').select('id, name, selling_price, category, preparation_time_minutes, description, item_code');
  if (miErr) { console.error('menu_items err:', miErr); return; }

  const { data: lines } = await supabaseAdmin.from('recipe_lines').select('*');
  const { data: ingredients } = await supabaseAdmin.from('ingredients').select('id, name, current_cost, unit_of_measure, category');
  const { data: subRecipes } = await supabaseAdmin.from('sub_recipes').select('id, name, category, yield_qty, yield_unit');

  const miMap: Record<string, any> = {};
  for (const mi of menuItems || []) miMap[mi.id] = mi;
  const ingMap: Record<string, any> = {};
  for (const ing of ingredients || []) ingMap[ing.id] = ing;
  const srMap: Record<string, any> = {};
  for (const sr of subRecipes || []) srMap[sr.id] = sr;

  const result = (recipes || []).map((r: any) => ({
    ...r,
    menu_items: miMap[r.menu_item_id] || null,
    recipe_lines: (lines || []).filter((l: any) => l.recipe_id === r.id).map((l: any) => ({
      ...l,
      ingredients: ingMap[l.ingredient_id] || null,
      sub_recipe: srMap[l.sub_recipe_id] || null,
    })),
  }));

  console.log(`Total recipes: ${result.length}`);
  for (const r of result.slice(0, 8)) {
    const name = r.menu_items?.name || r.name || 'UNTITLED';
    const lineCount = r.recipe_lines?.length || 0;
    const srLines = (r.recipe_lines || []).filter((l: any) => l.sub_recipe_id).length;
    console.log(`  - ${name} | menu_item_id: ${r.menu_item_id || 'null'} | lines: ${lineCount} (${srLines} sub-recipe)`);
  }
}

main().catch(console.error);
