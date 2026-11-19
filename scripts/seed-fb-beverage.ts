import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function seed() {
  if (!supabaseAdmin) { console.error('Supabase not configured'); process.exit(1); }
  console.log('[SEED] Starting F&B beverage management seed...');

  // Seed Beverage Categories
  console.log('[SEED] Seeding beverage categories...');
  const categories = [
    { name: 'Cocktails', description: 'Mixed drinks and cocktails', display_order: 1, is_active: true },
    { name: 'Wine', description: 'Red, white, sparkling wines', display_order: 2, is_active: true },
    { name: 'Beer', description: 'Draft and bottled beer', display_order: 3, is_active: true },
    { name: 'Spirits', description: 'Liquors and spirits', display_order: 4, is_active: true },
    { name: 'Non-Alcoholic', description: 'Soft drinks, juices, mocktails', display_order: 5, is_active: true },
    { name: 'Coffee & Tea', description: 'Hot and cold beverages', display_order: 6, is_active: true },
  ];

  const { data: existingCategories } = await supabaseAdmin.from('fb_beverage_categories').select('name');
  const categoryKeys = new Set(existingCategories?.map(c => c.name) || []);
  const newCategories = categories.filter(c => !categoryKeys.has(c.name));

  if (newCategories.length > 0) {
    const { data: insertedCategories } = await supabaseAdmin.from('fb_beverage_categories').insert(newCategories).select();
    console.log(`[SEED] Beverage categories: ${newCategories.length} new`);
  } else {
    console.log('[SEED] Beverage categories: 0 new');
  }

  // Fetch menu items for wine list
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, name').limit(5);
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id').limit(1);
  const outletId = outlets?.[0]?.id;

  // Seed Wine List
  if (menuItems && menuItems.length > 0) {
    console.log('[SEED] Seeding wine list...');
    const wines = [
      {
        menu_item_id: menuItems[0]?.id,
        wine_type: 'Red',
        vintage: 2020,
        region: 'Napa Valley',
        country: 'USA',
        producer: 'Opus One',
        grape_variety: 'Cabernet Sauvignon',
        alcohol_content: 14.5,
        serving_temperature: 'Room Temperature',
        glass_type: 'Red Wine Glass',
        is_by_the_glass: true,
        bottle_price: 150.00,
        glass_price: 25.00,
        is_active: true,
      },
      {
        menu_item_id: menuItems[1]?.id,
        wine_type: 'White',
        vintage: 2021,
        region: 'Burgundy',
        country: 'France',
        producer: 'Domaine Leflaive',
        grape_variety: 'Chardonnay',
        alcohol_content: 13.5,
        serving_temperature: 'Chilled',
        glass_type: 'White Wine Glass',
        is_by_the_glass: true,
        bottle_price: 120.00,
        glass_price: 20.00,
        is_active: true,
      },
    ];

    const { data: existingWines } = await supabaseAdmin.from('fb_wine_list').select('menu_item_id');
    const wineKeys = new Set(existingWines?.map(w => w.menu_item_id) || []);
    const newWines = wines.filter(w => !wineKeys.has(w.menu_item_id));

    if (newWines.length > 0) {
      const { error } = await supabaseAdmin.from('fb_wine_list').insert(newWines);
      if (error) throw error;
      console.log(`[SEED] Wine list: ${newWines.length} new`);
    } else {
      console.log('[SEED] Wine list: 0 new');
    }
  }

  // Seed Beverage Menu Item Categories
  if (menuItems && outletId) {
    console.log('[SEED] Seeding beverage menu item categories...');
    const { data: allCategories } = await supabaseAdmin.from('fb_beverage_categories').select('id').limit(3);
    const categoryId = allCategories?.[0]?.id;

    if (categoryId) {
      const itemCategories = menuItems.slice(0, 3).map(mi => ({
        menu_item_id: mi.id,
        beverage_category_id: categoryId,
        outlet_id: outletId,
        is_available: true,
      }));

      const { data: existingItemCats } = await supabaseAdmin.from('fb_beverage_menu_item_categories').select('menu_item_id');
      const itemCatKeys = new Set(existingItemCats?.map(c => c.menu_item_id) || []);
      const newItemCats = itemCategories.filter(c => !itemCatKeys.has(c.menu_item_id));

      if (newItemCats.length > 0) {
        const { error } = await supabaseAdmin.from('fb_beverage_menu_item_categories').insert(newItemCats);
        if (error) throw error;
        console.log(`[SEED] Beverage menu item categories: ${newItemCats.length} new`);
      } else {
        console.log('[SEED] Beverage menu item categories: 0 new');
      }
    }
  }

  console.log('[DONE] F&B beverage management seed complete.');
}

seed().catch(console.error);