import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function seed() {
  if (!supabaseAdmin) { console.error('Supabase not configured'); process.exit(1); }
  console.log('[SEED] Starting F&B banquet seed...');

  // Fetch menu items to use in banquet menus
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, name, category').limit(20);

  // Seed Banquet Menus
  console.log('[SEED] Seeding banquet menus...');
  const banquetMenus = [
    {
      name: 'Classic Wedding Menu',
      description: 'Traditional 3-course wedding menu with appetizers, main course, and dessert',
      menu_type: 'Wedding',
      price_per_person: 85,
      min_guests: 50,
      max_guests: 500,
      courses: ['Appetizers', 'Main Course', 'Dessert'],
      is_active: true,
    },
    {
      name: 'Corporate Gala Menu',
      description: 'Premium corporate event menu with cocktail reception and plated dinner',
      menu_type: 'Corporate',
      price_per_person: 120,
      min_guests: 100,
      max_guests: 1000,
      courses: ['Cocktail Reception', 'Appetizers', 'Main Course', 'Dessert'],
      is_active: true,
    },
    {
      name: 'Conference Lunch Buffet',
      description: 'Buffet-style lunch for conferences and meetings',
      menu_type: 'Conference',
      price_per_person: 45,
      min_guests: 20,
      courses: ['Salads', 'Hot Main', 'Dessert', 'Beverages'],
      is_active: true,
    },
    {
      name: 'Birthday Celebration Menu',
      description: 'Fun and festive menu for birthday parties',
      menu_type: 'Birthday',
      price_per_person: 65,
      min_guests: 15,
      max_guests: 100,
      courses: ['Appetizers', 'Main Course', 'Cake', 'Beverages'],
      is_active: true,
    },
  ];

  const { data: existingMenus } = await supabaseAdmin.from('fb_banquet_menus').select('name');
  const menuKeys = new Set(existingMenus?.map(m => m.name) || []);
  const newMenus = banquetMenus.filter(m => !menuKeys.has(m.name));

  let menuIdMap: Record<string, string> = {};
  if (newMenus.length > 0) {
    const { data: insertedMenus } = await supabaseAdmin.from('fb_banquet_menus').insert(newMenus).select();
    for (const m of insertedMenus || []) menuIdMap[m.name] = m.id;
    console.log(`[SEED] Banquet menus: ${newMenus.length} new`);
  } else {
    console.log('[SEED] Banquet menus: 0 new');
    for (const m of existingMenus || []) menuIdMap[m.name] = m.id;
  }

  // Seed Banquet Packages
  console.log('[SEED] Seeding banquet packages...');
  const banquetPackages = [
    {
      name: 'All-Inclusive Wedding Package',
      description: 'Complete wedding package with food, beverages, and service',
      package_type: 'All-Inclusive',
      price_per_person: 150,
      min_guests: 50,
      max_guests: 500,
      includes_food: true,
      includes_beverage: true,
      includes_service: true,
      inclusions: { setup: true, linens: true, decor: true, staff: true },
      is_active: true,
    },
    {
      name: 'Corporate Standard Package',
      description: 'Standard corporate event package with food and basic service',
      package_type: 'Standard',
      price_per_person: 95,
      min_guests: 30,
      max_guests: 300,
      includes_food: true,
      includes_beverage: true,
      includes_service: true,
      inclusions: { setup: true, linens: true, decor: false, staff: true },
      is_active: true,
    },
    {
      name: 'Budget Conference Package',
      description: 'Affordable package for conferences and meetings',
      package_type: 'Budget',
      price_per_person: 55,
      min_guests: 20,
      includes_food: true,
      includes_beverage: false,
      includes_service: true,
      inclusions: { setup: false, linens: false, decor: false, staff: true },
      is_active: true,
    },
  ];

  const { data: existingPackages } = await supabaseAdmin.from('fb_banquet_packages').select('name');
  const packageKeys = new Set(existingPackages?.map(p => p.name) || []);
  const newPackages = banquetPackages.filter(p => !packageKeys.has(p.name));

  let packageIdMap: Record<string, string> = {};
  if (newPackages.length > 0) {
    const { data: insertedPackages } = await supabaseAdmin.from('fb_banquet_packages').insert(newPackages).select();
    for (const p of insertedPackages || []) packageIdMap[p.name] = p.id;
    console.log(`[SEED] Banquet packages: ${newPackages.length} new`);
  } else {
    console.log('[SEED] Banquet packages: 0 new');
    for (const p of existingPackages || []) packageIdMap[p.name] = p.id;
  }

  console.log('[DONE] F&B banquet seed complete.');
}

seed().catch(console.error);