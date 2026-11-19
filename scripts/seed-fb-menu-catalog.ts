/**
 * Seed F&B Menu Catalog sample data
 * Run: npx tsx scripts/seed-fb-menu-catalog.ts
 *
 * Inserts sample: menu items, menus, menu_items_menus, modifier groups + options,
 * availability rules, digital menus + items, stations + menu_item_stations,
 * menu_item_outlets.
 */
import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

type Outlet = { id: string; name: string; type: string };
type MenuType = { id: string; name: string };

async function seedMenuCatalog() {
  // ── 1. Load outlets & menu_types ──────────────────────────────────────
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name, type').order('name');
  if (!outlets || outlets.length === 0) {
    console.error('[SEED] No outlets found. Run seed-fb-outlets.ts first.');
    process.exit(1);
  }
  const outletByName = Object.fromEntries(outlets.map((o: Outlet) => [o.name, o.id]));
  const { data: menuTypes } = await supabaseAdmin.from('menu_types').select('id, name');
  const mtByName = Object.fromEntries((menuTypes || []).map((m: MenuType) => [m.name, m.id]));

  // ── 2. Stations ───────────────────────────────────────────────────────
  const stationDefs = [
    { outlet: 'La Maison Restaurant', name: 'Hot Kitchen', code: 'HOT', station_type: 'cooking', display_order: 1 },
    { outlet: 'La Maison Restaurant', name: 'Cold Prep', code: 'COLD', station_type: 'prep', display_order: 2 },
    { outlet: 'La Maison Restaurant', name: 'Grill', code: 'GRILL', station_type: 'cooking', display_order: 3 },
    { outlet: 'La Maison Restaurant', name: 'Dessert', code: 'DESS', station_type: 'dessert', display_order: 4 },
    { outlet: 'Sky Lounge Bar', name: 'Bar', code: 'BAR', station_type: 'bar', display_order: 1 },
    { outlet: 'Room Service', name: 'RS Kitchen', code: 'RSK', station_type: 'prep', display_order: 1 },
  ];

  const stationIdByCode: Record<string, string> = {};
  for (const s of stationDefs) {
    const oid = outletByName[s.outlet];
    if (!oid) continue;
    const { data: existing } = await supabaseAdmin.from('stations').select('id').eq('code', s.code).maybeSingle();
    if (existing) { stationIdByCode[s.code] = existing.id; continue; }
    const { data, error } = await supabaseAdmin.from('stations').insert({
      outlet_id: oid, name: s.name, code: s.code, station_type: s.station_type, display_order: s.display_order, kds_enabled: true, is_active: true
    }).select().single();
    if (error) { console.error('[SEED] station', s.code, error.message); continue; }
    stationIdByCode[s.code] = data.id;
  }
  console.log(`[SEED] Stations: ${Object.keys(stationIdByCode).length}`);

  // ── 3. Menu Items ─────────────────────────────────────────────────────
  const itemDefs = [
    // La Maison Restaurant
    { name: 'Margherita Pizza', category: 'Main Course', subcategory: 'Pizza', price: 16.80, outlet: 'La Maison Restaurant', station: 'HOT', desc: 'Classic pizza with fresh mozzarella, basil, and tomato sauce', allergens: ['gluten','dairy'], dietary: ['vegetarian'], meal: ['Lunch','Dinner'], prep: 18, code: 'LM-001' },
    { name: 'Grilled Salmon', category: 'Main Course', subcategory: 'Seafood', price: 30.62, outlet: 'La Maison Restaurant', station: 'GRILL', desc: 'Atlantic salmon with lemon butter sauce and seasonal vegetables', allergens: ['fish'], dietary: ['gluten-free'], meal: ['Dinner'], prep: 22, code: 'LM-002' },
    { name: 'Caesar Salad', category: 'Appetizer', subcategory: 'Salad', price: 11.07, outlet: 'La Maison Restaurant', station: 'COLD', desc: 'Crisp romaine lettuce, parmesan, croutons, and Caesar dressing', allergens: ['gluten','dairy','egg'], dietary: [], meal: ['Lunch','Dinner'], prep: 8, code: 'LM-003' },
    { name: 'Tiramisu', category: 'Dessert', subcategory: 'Cake', price: 9.23, outlet: 'La Maison Restaurant', station: 'DESS', desc: 'Classic Italian dessert with mascarpone and espresso', allergens: ['gluten','dairy','egg'], dietary: ['vegetarian'], meal: ['Lunch','Dinner'], prep: 5, code: 'LM-004' },
    { name: 'French Onion Soup', category: 'Appetizer', subcategory: 'Soup', price: 8.50, outlet: 'La Maison Restaurant', station: 'HOT', desc: 'Caramelized onions, beef broth, and melted gruyère', allergens: ['gluten','dairy'], dietary: [], meal: ['Dinner'], prep: 12, code: 'LM-005' },
    { name: 'Beef Tenderloin', category: 'Main Course', subcategory: 'Steak', price: 42.00, outlet: 'La Maison Restaurant', station: 'GRILL', desc: '8oz tenderloin with truffle mash and red wine reduction', allergens: ['sulphites'], dietary: ['gluten-free'], meal: ['Dinner'], prep: 25, code: 'LM-006' },
    // Sky Lounge Bar
    { name: 'Classic Mojito', category: 'Cocktail', subcategory: 'Rum', price: 14.00, outlet: 'Sky Lounge Bar', station: 'BAR', desc: 'White rum, mint, lime, sugar, and soda water', allergens: [], dietary: ['vegan'], meal: ['All Day'], prep: 5, code: 'SL-001' },
    { name: 'Old Fashioned', category: 'Cocktail', subcategory: 'Whiskey', price: 16.00, outlet: 'Sky Lounge Bar', station: 'BAR', desc: 'Bourbon, sugar, bitters, and orange peel', allergens: [], dietary: ['vegan'], meal: ['All Day'], prep: 4, code: 'SL-002' },
    { name: 'Espresso Martini', category: 'Cocktail', subcategory: 'Vodka', price: 15.00, outlet: 'Sky Lounge Bar', station: 'BAR', desc: 'Vodka, espresso, coffee liqueur, and simple syrup', allergens: [], dietary: ['vegetarian'], meal: ['All Day'], prep: 5, code: 'SL-003' },
    { name: 'Calamari Fritti', category: 'Bar Bites', subcategory: 'Fried', price: 13.50, outlet: 'Sky Lounge Bar', station: 'HOT', desc: 'Crispy fried calamari with aioli dip', allergens: ['gluten','shellfish','egg'], dietary: [], meal: ['All Day'], prep: 12, code: 'SL-004' },
    // Room Service
    { name: 'Club Sandwich', category: 'Main Course', subcategory: 'Sandwich', price: 12.00, outlet: 'Room Service', station: 'RSK', desc: 'Triple-decker sandwich with turkey, bacon, lettuce, and tomato', allergens: ['gluten','egg'], dietary: [], meal: ['All Day'], prep: 10, code: 'RS-001' },
    { name: 'Continental Breakfast', category: 'Breakfast', subcategory: 'Set', price: 18.00, outlet: 'Room Service', station: 'RSK', desc: 'Croissant, jam, fresh fruit, coffee, and orange juice', allergens: ['gluten','dairy'], dietary: ['vegetarian'], meal: ['Breakfast'], prep: 15, code: 'RS-002' },
    { name: 'Cheeseburger & Fries', category: 'Main Course', subcategory: 'Burger', price: 16.50, outlet: 'Room Service', station: 'RSK', desc: 'Beef patty, cheddar, lettuce, tomato, and crispy fries', allergens: ['gluten','dairy'], dietary: [], meal: ['All Day'], prep: 15, code: 'RS-003' },
    { name: 'Pasta Carbonara', category: 'Main Course', subcategory: 'Pasta', price: 19.00, outlet: 'Room Service', station: 'RSK', desc: 'Spaghetti with pancetta, egg, and parmesan', allergens: ['gluten','dairy','egg'], dietary: [], meal: ['All Day'], prep: 18, code: 'RS-004' },
  ];

  const itemIdByCode: Record<string, string> = {};
  for (const it of itemDefs) {
    const oid = outletByName[it.outlet];
    if (!oid) continue;
    const { data: existing } = await supabaseAdmin.from('menu_items').select('id').eq('item_code', it.code).maybeSingle();
    if (existing) { itemIdByCode[it.code] = existing.id; continue; }
    const body: Record<string, unknown> = {
      outlet_id: oid,
      name: it.name,
      category: it.category,
      subcategory: it.subcategory,
      selling_price: it.price,
      tax_code: 'STD',
      is_active: true,
      pos_button_group: it.category,
      meal_periods: it.meal,
      is_fixed_menu: false,
      item_code: it.code,
      description: it.desc,
      allergen_info: it.allergens,
      preparation_time_minutes: it.prep,
      default_station_id: it.station ? stationIdByCode[it.station] : null,
    };
    const { data, error } = await supabaseAdmin.from('menu_items').insert(body).select().single();
    if (error) { console.error('[SEED] menu_item', it.code, error.message); continue; }
    itemIdByCode[it.code] = data.id;
  }
  console.log(`[SEED] Menu items: ${Object.keys(itemIdByCode).length}`);

  // ── 4. Menu Item Outlets (multi-outlet links) ─────────────────────────
  // Make Room Service items also available in La Maison and vice versa for a couple
  const crossLinks = [
    { item: 'LM-003', outlet: 'Room Service', is_primary: false },
    { item: 'LM-004', outlet: 'Room Service', is_primary: false },
    { item: 'RS-003', outlet: 'La Maison Restaurant', is_primary: false },
  ];
  let linkCount = 0;
  for (const cl of crossLinks) {
    const itemId = itemIdByCode[cl.item];
    const outletId = outletByName[cl.outlet];
    if (!itemId || !outletId) continue;
    const { error } = await supabaseAdmin.from('menu_item_outlets').upsert({
      menu_item_id: itemId, outlet_id: outletId, is_primary: cl.is_primary
    }, { onConflict: 'menu_item_id,outlet_id' });
    if (error) console.error('[SEED] menu_item_outlet', cl.item, error.message);
    else linkCount++;
  }
  console.log(`[SEED] Menu item outlets: ${linkCount}`);

  // ── 5. Menus ──────────────────────────────────────────────────────────
  const menuDefs = [
    { name: 'La Maison All-Day Dining', outlet: 'La Maison Restaurant', type: 'a_la_carte', desc: 'All-day à la carte menu', base_price: null, valid_from: '2026-01-01', valid_to: '2026-12-31', published: true },
    { name: 'La Maison Dinner Menu', outlet: 'La Maison Restaurant', type: 'a_la_carte', desc: 'Evening fine dining menu', base_price: null, valid_from: '2026-01-01', valid_to: '2026-12-31', published: true },
    { name: 'Sky Lounge Drink Menu', outlet: 'Sky Lounge Bar', type: 'drink_menu', desc: 'Cocktails and bar bites', base_price: null, valid_from: '2026-01-01', valid_to: '2026-12-31', published: true },
    { name: 'Room Service Menu', outlet: 'Room Service', type: 'room_service', desc: '24-hour in-room dining', base_price: null, valid_from: '2026-01-01', valid_to: '2026-12-31', published: true },
    { name: 'Weekend Brunch Set', outlet: 'La Maison Restaurant', type: 'table_dhote', desc: 'Fixed-price 3-course weekend brunch', base_price: 45.00, valid_from: '2026-01-01', valid_to: '2026-12-31', published: false },
  ];

  const menuIdByName: Record<string, string> = {};
  for (const m of menuDefs) {
    const oid = outletByName[m.outlet];
    const tid = mtByName[m.type];
    if (!oid || !tid) continue;
    const { data: existing } = await supabaseAdmin.from('menus').select('id').eq('name', m.name).maybeSingle();
    if (existing) { menuIdByName[m.name] = existing.id; continue; }
    const { data, error } = await supabaseAdmin.from('menus').insert({
      outlet_id: oid, menu_type_id: tid, name: m.name, description: m.desc,
      base_price: m.base_price, currency: 'USD', valid_from: m.valid_from, valid_to: m.valid_to,
      is_published: m.published, is_active: true, sort_order: 0
    }).select().single();
    if (error) { console.error('[SEED] menu', m.name, error.message); continue; }
    menuIdByName[m.name] = data.id;
  }
  console.log(`[SEED] Menus: ${Object.keys(menuIdByName).length}`);

  // ── 6. Menu Items ↔ Menus ─────────────────────────────────────────────
  const menuItemsLinks = [
    { menu: 'La Maison All-Day Dining', item: 'LM-003', course: null, order: 1, featured: true },
    { menu: 'La Maison All-Day Dining', item: 'LM-001', course: null, order: 2, featured: false },
    { menu: 'La Maison All-Day Dining', item: 'LM-004', course: null, order: 3, featured: false },
    { menu: 'La Maison Dinner Menu', item: 'LM-005', course: 'Appetizer', order: 1, featured: false },
    { menu: 'La Maison Dinner Menu', item: 'LM-002', course: 'Main', order: 2, featured: true },
    { menu: 'La Maison Dinner Menu', item: 'LM-006', course: 'Main', order: 3, featured: true },
    { menu: 'La Maison Dinner Menu', item: 'LM-004', course: 'Dessert', order: 4, featured: false },
    { menu: 'Sky Lounge Drink Menu', item: 'SL-001', course: null, order: 1, featured: true },
    { menu: 'Sky Lounge Drink Menu', item: 'SL-002', course: null, order: 2, featured: false },
    { menu: 'Sky Lounge Drink Menu', item: 'SL-003', course: null, order: 3, featured: false },
    { menu: 'Sky Lounge Drink Menu', item: 'SL-004', course: null, order: 4, featured: false },
    { menu: 'Room Service Menu', item: 'RS-001', course: null, order: 1, featured: false },
    { menu: 'Room Service Menu', item: 'RS-002', course: null, order: 2, featured: false },
    { menu: 'Room Service Menu', item: 'RS-003', course: null, order: 3, featured: true },
    { menu: 'Room Service Menu', item: 'RS-004', course: null, order: 4, featured: false },
    { menu: 'Room Service Menu', item: 'LM-003', course: null, order: 5, featured: false },
  ];

  let mimCount = 0;
  for (const l of menuItemsLinks) {
    const menuId = menuIdByName[l.menu];
    const itemId = itemIdByCode[l.item];
    if (!menuId || !itemId) continue;
    const { error } = await supabaseAdmin.from('menu_items_menus').upsert({
      menu_id: menuId, menu_item_id: itemId, course_name: l.course,
      display_order: l.order, is_available: true, is_featured: l.featured,
      dietary_tags: []
    }, { onConflict: 'menu_id,menu_item_id' });
    if (error) console.error('[SEED] menu_items_menus', l.menu, l.item, error.message);
    else mimCount++;
  }
  console.log(`[SEED] Menu items ↔ menus: ${mimCount}`);

  // ── 7. Modifier Groups + Options ──────────────────────────────────────
  const modGroupDefs = [
    { name: 'Cooking Temperature', outlet: 'La Maison Restaurant', selection: 'single', min: 1, max: 1, required: true, options: [
      { name: 'Rare', price: 0, def: false },
      { name: 'Medium Rare', price: 0, def: true },
      { name: 'Medium', price: 0, def: false },
      { name: 'Medium Well', price: 0, def: false },
      { name: 'Well Done', price: 0, def: false },
    ]},
    { name: 'Pizza Toppings', outlet: 'La Maison Restaurant', selection: 'multi', min: 0, max: 5, required: false, options: [
      { name: 'Extra Cheese', price: 2.50, def: false },
      { name: 'Mushrooms', price: 1.50, def: false },
      { name: 'Pepperoni', price: 2.00, def: false },
      { name: 'Olives', price: 1.00, def: false },
      { name: 'Arugula', price: 1.50, def: false },
    ]},
    { name: 'Salad Dressing', outlet: 'La Maison Restaurant', selection: 'single', min: 1, max: 1, required: true, options: [
      { name: 'Caesar', price: 0, def: true },
      { name: 'Balsamic Vinaigrette', price: 0, def: false },
      { name: 'Ranch', price: 0, def: false },
      { name: 'No Dressing', price: 0, def: false },
    ]},
    { name: 'Cocktail Garnish', outlet: 'Sky Lounge Bar', selection: 'multi', min: 0, max: 3, required: false, options: [
      { name: 'Lime Wedge', price: 0, def: true },
      { name: 'Orange Peel', price: 0, def: false },
      { name: 'Cherry', price: 0.50, def: false },
      { name: 'Olive', price: 0.50, def: false },
    ]},
  ];

  let mgCount = 0, moCount = 0;
  for (const mg of modGroupDefs) {
    const oid = outletByName[mg.outlet];
    if (!oid) continue;
    const { data: existing } = await supabaseAdmin.from('menu_modifier_groups').select('id').eq('name', mg.name).eq('outlet_id', oid).maybeSingle();
    let gid = existing?.id;
    if (!gid) {
      const { data, error } = await supabaseAdmin.from('menu_modifier_groups').insert({
        outlet_id: oid, name: mg.name, selection_type: mg.selection,
        min_selections: mg.min, max_selections: mg.max, is_required: mg.required,
        sort_order: 0, is_active: true
      }).select().single();
      if (error) { console.error('[SEED] mod_group', mg.name, error.message); continue; }
      gid = data.id; mgCount++;
    }
    for (let i = 0; i < mg.options.length; i++) {
      const opt = mg.options[i];
      const { data: optExisting } = await supabaseAdmin.from('menu_modifier_options').select('id').eq('modifier_group_id', gid).eq('name', opt.name).maybeSingle();
      if (optExisting) continue;
      const { error } = await supabaseAdmin.from('menu_modifier_options').insert({
        modifier_group_id: gid, name: opt.name, price_adjustment: opt.price,
        is_default: opt.def, sort_order: i, is_active: true
      });
      if (error) console.error('[SEED] mod_option', opt.name, error.message);
      else moCount++;
    }
  }
  console.log(`[SEED] Modifier groups: ${mgCount}, options: ${moCount}`);

  // ── 8. Availability Rules ─────────────────────────────────────────────
  const availDefs = [
    { item: 'LM-006', rule: 'time_based', days: [0,1,2,3,4,5,6], start: '17:00', end: '22:30', available: true, reason: 'Dinner only' },
    { item: 'RS-002', rule: 'time_based', days: [0,1,2,3,4,5,6], start: '06:00', end: '11:00', available: true, reason: 'Breakfast hours' },
    { item: 'SL-001', rule: 'daily', days: [0,1,2,3,4,5,6], start: '16:00', end: '02:00', available: true, reason: 'Bar hours' },
  ];
  let arCount = 0;
  for (const a of availDefs) {
    const itemId = itemIdByCode[a.item];
    if (!itemId) continue;
    const { data: existing } = await supabaseAdmin.from('menu_availability_rules').select('id').eq('menu_item_id', itemId).eq('rule_type', a.rule).maybeSingle();
    if (existing) continue;
    const { error } = await supabaseAdmin.from('menu_availability_rules').insert({
      menu_item_id: itemId, rule_type: a.rule, applicable_days: a.days,
      start_time: a.start, end_time: a.end, is_available: a.available,
      reason: a.reason, is_active: true
    });
    if (error) console.error('[SEED] avail', a.item, error.message);
    else arCount++;
  }
  console.log(`[SEED] Availability rules: ${arCount}`);

  // ── 9. Digital Menus + Items ──────────────────────────────────────────
  const digitalMenuDefs = [
    { name: 'La Maison QR Menu', outlet: 'La Maison Restaurant', desc: 'Scan-to-view digital menu', lang: ['en','fr','it'] },
    { name: 'Sky Lounge QR Menu', outlet: 'Sky Lounge Bar', desc: 'Cocktail menu with pairings', lang: ['en'] },
  ];
  let dmCount = 0;
  for (const dm of digitalMenuDefs) {
    const oid = outletByName[dm.outlet];
    if (!oid) continue;
    const { data: existing } = await supabaseAdmin.from('digital_menus').select('id').eq('name', dm.name).maybeSingle();
    let did = existing?.id;
    if (!did) {
      const { data, error } = await supabaseAdmin.from('digital_menus').insert({
        outlet_id: oid, name: dm.name, description: dm.desc,
        primary_language: 'en', supported_languages: dm.lang,
        is_published: true, is_active: true
      }).select().single();
      if (error) { console.error('[SEED] digital_menu', dm.name, error.message); continue; }
      did = data.id; dmCount++;
    }
    // Add items to digital menu
    const itemsForMenu = itemDefs.filter(i => i.outlet === dm.outlet);
    let dmiCount = 0;
    for (let i = 0; i < itemsForMenu.length; i++) {
      const it = itemsForMenu[i];
      const itemId = itemIdByCode[it.code];
      if (!itemId) continue;
      const { data: dmiExisting } = await supabaseAdmin.from('digital_menu_items').select('id').eq('digital_menu_id', did).eq('menu_item_id', itemId).maybeSingle();
      if (dmiExisting) continue;
      const { error } = await supabaseAdmin.from('digital_menu_items').insert({
        digital_menu_id: did, menu_item_id: itemId, display_category: it.category,
        sort_order: i + 1, is_featured: i === 0, is_visible: true
      });
      if (error) console.error('[SEED] digital_menu_item', it.code, error.message);
      else dmiCount++;
    }
    console.log(`  └ Digital menu "${dm.name}": ${dmiCount} items`);
  }
  console.log(`[SEED] Digital menus: ${dmCount}`);

  console.log('\n[DONE] Menu catalog seed complete.');
}

seedMenuCatalog().catch(err => {
  console.error('[SEED] Unexpected error:', err);
  process.exit(1);
});
