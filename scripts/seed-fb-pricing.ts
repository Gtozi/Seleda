import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';
import { randomUUID } from 'crypto';

async function main() {
  if (!supabaseAdmin) { console.error('Supabase not configured'); process.exit(1); }

  // Fetch outlets
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name, type').order('name');
  const outletByName: Record<string, any> = {};
  for (const o of outlets || []) outletByName[o.name] = o;

  // Fetch menu items
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, name, selling_price, item_code').order('name');
  const miByName: Record<string, any> = {};
  for (const m of menuItems || []) miByName[m.name] = m;

  let newPriceLists = 0, newPriceListItems = 0;
  let newMealPlans = 0;
  let newPackages = 0, newPackageComponents = 0, newPackageOutlets = 0;
  let newPromotions = 0;
  let newSpecialOffers = 0;

  // ── Price Lists ──────────────────────────────────────────────────
  const priceListsData = [
    {
      name: 'La Maison À La Carte',
      outletName: 'La Maison Restaurant',
      currency: 'USD',
      effectiveFrom: '2026-01-15',
      status: 'Active',
      description: 'Fine dining à la carte price list for dinner service',
      items: [
        { menuItemName: 'Margherita Pizza', price: 16.80 },
        { menuItemName: 'Grilled Salmon', price: 30.62 },
        { menuItemName: 'Caesar Salad', price: 11.07 },
        { menuItemName: 'Beef Tenderloin', price: 42.00 },
        { menuItemName: 'French Onion Soup', price: 8.50 },
        { menuItemName: 'Tiramisu', price: 9.23 },
      ],
    },
    {
      name: 'Sky Lounge Bar Menu',
      outletName: 'Sky Lounge Bar',
      currency: 'USD',
      effectiveFrom: '2026-02-01',
      status: 'Active',
      description: 'Bar menu — cocktails, spirits, and bar snacks',
      items: [
        { menuItemName: 'Classic Mojito', price: 14.00 },
        { menuItemName: 'Old Fashioned', price: 16.00 },
        { menuItemName: 'Espresso Martini', price: 15.00 },
        { menuItemName: 'Calamari Fritti', price: 13.50 },
      ],
    },
    {
      name: 'Room Service Overnight',
      outletName: 'Room Service',
      currency: 'USD',
      effectiveFrom: '2026-03-01',
      status: 'Draft',
      description: 'Overnight room service menu — limited selection',
      items: [
        { menuItemName: 'Club Sandwich', price: 12.00 },
        { menuItemName: 'Continental Breakfast', price: 18.00 },
        { menuItemName: 'Cheeseburger & Fries', price: 16.50 },
        { menuItemName: 'Pasta Carbonara', price: 19.00 },
      ],
    },
    {
      name: 'Grand Ballroom Banquet Pricing',
      outletName: 'Grand Ballroom Banquet',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      status: 'Active',
      description: 'Banquet event pricing — per cover basis',
      items: [],
    },
  ];

  for (const pl of priceListsData) {
    const existing = await supabaseAdmin.from('fb_price_lists').select('id').eq('name', pl.name).maybeSingle();
    if (existing.data) { continue; }
    const id = randomUUID();
    const outlet = outletByName[pl.outletName];
    const { error } = await supabaseAdmin.from('fb_price_lists').insert({
      id, name: pl.name, outlet_id: outlet?.id || null, outlet_name: pl.outletName,
      currency: pl.currency, effective_from: pl.effectiveFrom, status: pl.status,
      description: pl.description,
    });
    if (error) { console.error('[SEED] Price list error:', pl.name, error.message); continue; }
    newPriceLists++;

    for (const it of pl.items) {
      const mi = miByName[it.menuItemName];
      const { error: ie } = await supabaseAdmin.from('fb_price_list_items').insert({
        id: randomUUID(), price_list_id: id, menu_item_id: mi?.id || null,
        menu_item_name: it.menuItemName, price: it.price,
      });
      if (ie) { console.error('[SEED] PL item error:', it.menuItemName, ie.message); }
      else newPriceListItems++;
    }
  }

  // ── Meal Plans ───────────────────────────────────────────────────
  const mealPlansData = [
    { name: 'Bed & Breakfast', type: 'Bed & Breakfast', adultPrice: 35, childPrice: 18, includes: ['Breakfast Buffet'], status: 'Active', description: 'Daily breakfast buffet at La Maison Restaurant' },
    { name: 'Half Board Standard', type: 'Half Board', adultPrice: 78, childPrice: 39, includes: ['Breakfast', 'Dinner'], status: 'Active', description: 'Breakfast and dinner — choice of outlets' },
    { name: 'Full Board Premium', type: 'Full Board', adultPrice: 120, childPrice: 60, includes: ['Breakfast', 'Lunch', 'Dinner'], status: 'Active', description: 'All three meals — premium outlet access' },
    { name: 'All Inclusive', type: 'All Inclusive', adultPrice: 185, childPrice: 92, includes: ['Breakfast', 'Lunch', 'Dinner', 'Selected Beverages', 'Minibar'], status: 'Active', description: 'Full board plus selected beverages and minibar' },
    { name: 'Room Only', type: 'Room Only', adultPrice: 0, childPrice: 0, includes: [], status: 'Active', description: 'No meals included' },
  ];

  for (const mp of mealPlansData) {
    const existing = await supabaseAdmin.from('fb_meal_plans').select('id').eq('name', mp.name).maybeSingle();
    if (existing.data) { continue; }
    const { error } = await supabaseAdmin.from('fb_meal_plans').insert({
      id: randomUUID(), name: mp.name, type: mp.type, adult_price: mp.adultPrice,
      child_price: mp.childPrice, includes: mp.includes, status: mp.status, description: mp.description,
    });
    if (error) { console.error('[SEED] Meal plan error:', mp.name, error.message); }
    else newMealPlans++;
  }

  // ── Packages ─────────────────────────────────────────────────────
  const packagesData = [
    {
      name: 'Conference Package',
      description: 'Full-day conference package with coffee breaks and lunch buffet',
      packageType: 'conference',
      pricePerPerson: 65,
      minCovers: 20,
      status: 'Active',
      components: [
        { componentName: 'Morning Coffee Break', componentType: 'beverage' },
        { componentName: 'Lunch Buffet', componentType: 'meal' },
        { componentName: 'Afternoon Coffee Break', componentType: 'beverage' },
        { componentName: 'AV Equipment & Setup', componentType: 'service' },
      ],
      outlets: ['Grand Ballroom Banquet'],
    },
    {
      name: 'Wedding Package Gold',
      description: 'Premium wedding package — cocktail reception, three-course dinner, cake, and midnight snack',
      packageType: 'wedding',
      pricePerPerson: 145,
      minCovers: 50,
      status: 'Active',
      components: [
        { componentName: 'Cocktail Reception', componentType: 'beverage' },
        { componentName: 'Three-Course Dinner', componentType: 'meal' },
        { componentName: 'Wedding Cake', componentType: 'item' },
        { componentName: 'Midnight Snack', componentType: 'snack' },
      ],
      outlets: ['Grand Ballroom Banquet'],
    },
    {
      name: 'Cocktail Package',
      description: 'Signature cocktail package with canapés — perfect for receptions',
      packageType: 'cocktail',
      pricePerPerson: 48,
      minCovers: 10,
      status: 'Active',
      components: [
        { componentName: '3 Signature Cocktails', componentType: 'beverage' },
        { componentName: 'Canapés Selection', componentType: 'snack' },
      ],
      outlets: ['Sky Lounge Bar'],
    },
    {
      name: 'Beverage Package Premium',
      description: 'Unlimited house wine, selected spirits, and soft drinks',
      packageType: 'beverage',
      pricePerPerson: 55,
      minCovers: 2,
      status: 'Inactive',
      components: [
        { componentName: 'Unlimited House Wine', componentType: 'beverage' },
        { componentName: 'Selected Spirits', componentType: 'beverage' },
        { componentName: 'Soft Drinks', componentType: 'beverage' },
      ],
      outlets: ['Sky Lounge Bar', 'La Maison Restaurant'],
    },
    {
      name: 'Breakfast Buffet Package',
      description: 'Continental and hot breakfast buffet — per person',
      packageType: 'breakfast',
      pricePerPerson: 28,
      minCovers: 10,
      status: 'Active',
      components: [
        { componentName: 'Continental Breakfast Spread', componentType: 'meal' },
        { componentName: 'Hot Breakfast Station', componentType: 'meal' },
        { componentName: 'Fresh Juices & Coffee', componentType: 'beverage' },
      ],
      outlets: ['La Maison Restaurant', 'MAIN'],
    },
  ];

  for (const pkg of packagesData) {
    const existing = await supabaseAdmin.from('fb_packages').select('id').eq('name', pkg.name).maybeSingle();
    if (existing.data) { continue; }
    const id = randomUUID();
    const { error } = await supabaseAdmin.from('fb_packages').insert({
      id, name: pkg.name, description: pkg.description, package_type: pkg.packageType,
      price_per_person: pkg.pricePerPerson, min_covers: pkg.minCovers, status: pkg.status,
    });
    if (error) { console.error('[SEED] Package error:', pkg.name, error.message); continue; }
    newPackages++;

    for (let i = 0; i < pkg.components.length; i++) {
      const c = pkg.components[i];
      const { error: ce } = await supabaseAdmin.from('fb_package_components').insert({
        id: randomUUID(), package_id: id, component_name: c.componentName,
        component_type: c.componentType, sort_order: i,
      });
      if (ce) { console.error('[SEED] Component error:', c.componentName, ce.message); }
      else newPackageComponents++;
    }

    for (const on of pkg.outlets) {
      const outlet = outletByName[on];
      const { error: oe } = await supabaseAdmin.from('fb_package_outlets').insert({
        id: randomUUID(), package_id: id, outlet_id: outlet?.id || null, outlet_name: on,
      });
      if (oe) { console.error('[SEED] Package outlet error:', on, oe.message); }
      else newPackageOutlets++;
    }
  }

  // ── Promotions ───────────────────────────────────────────────────
  const promotionsData = [
    { name: 'Sunset Happy Hour', type: 'Happy Hour', discountDescription: '50% off all cocktails', discountValue: 50, discountType: 'percentage', schedule: '17:00–19:00 Daily', startDate: '2026-01-01', endDate: null, channels: ['POS', 'Guest Portal'], status: 'Active' },
    { name: 'Business Lunch BOGO', type: 'Buy One Get One', discountDescription: 'Buy 1 Get 1 Free on lunch mains', discountValue: 100, discountType: 'percentage', schedule: '12:00–14:00 Weekdays', startDate: '2026-01-01', endDate: null, channels: ['POS'], status: 'Active' },
    { name: 'Winter Set Menu', type: 'Set Menu', discountDescription: '3-course set menu $42', discountValue: 42, discountType: 'fixed', schedule: 'Nov–Feb', startDate: '2025-11-01', endDate: '2026-02-28', channels: ['POS', 'Public Booking'], status: 'Scheduled' },
    { name: 'Chef\'s Tasting Night', type: 'Chef Special', discountDescription: '7-course tasting menu $85', discountValue: 85, discountType: 'fixed', schedule: 'Every Friday', startDate: '2026-01-01', endDate: null, channels: ['POS', 'CRM'], status: 'Active' },
    { name: 'Early Bird Dinner', type: 'Early Dining', discountDescription: '25% off food 17:30–18:30', discountValue: 25, discountType: 'percentage', schedule: 'Daily 17:30–18:30', startDate: '2026-01-01', endDate: null, channels: ['POS', 'Guest Portal'], status: 'Active' },
    { name: 'Loyalty Members 15%', type: 'Loyalty', discountDescription: '15% off total food bill', discountValue: 15, discountType: 'percentage', schedule: 'Always', startDate: '2026-01-01', endDate: null, channels: ['POS', 'Mobile App'], status: 'Active' },
    { name: 'Summer Seafood Festival', type: 'Seasonal', discountDescription: 'Set menu $55 — seafood specialties', discountValue: 55, discountType: 'fixed', schedule: 'Jun–Aug', startDate: '2025-06-01', endDate: '2025-08-31', channels: ['POS', 'Public Booking', 'CRM'], status: 'Ended' },
    { name: 'Corporate Lunch Discount', type: 'Corporate', discountDescription: '10% off for corporate accounts', discountValue: 10, discountType: 'percentage', schedule: 'Weekdays', startDate: '2026-01-01', endDate: null, channels: ['POS', 'CRM'], status: 'Active' },
  ];

  for (const promo of promotionsData) {
    const existing = await supabaseAdmin.from('fb_promotions').select('id').eq('name', promo.name).maybeSingle();
    if (existing.data) { continue; }
    const { error } = await supabaseAdmin.from('fb_promotions').insert({
      id: randomUUID(), name: promo.name, type: promo.type, discount_description: promo.discountDescription,
      discount_value: promo.discountValue, discount_type: promo.discountType, schedule: promo.schedule,
      start_date: promo.startDate, end_date: promo.endDate, channels: promo.channels, status: promo.status,
    });
    if (error) { console.error('[SEED] Promotion error:', promo.name, error.message); }
    else newPromotions++;
  }

  // ── Special Offers ───────────────────────────────────────────────
  const specialOffersData = [
    { name: 'Valentine\'s Dinner for Two', description: '4-course romantic dinner with sparkling wine', outletName: 'La Maison Restaurant', validUntil: '2026-02-14', status: 'Active' },
    { name: 'New Year\'s Eve Gala', description: 'Gala dinner with live entertainment and midnight toast', outletName: 'Grand Ballroom Banquet', validUntil: '2026-12-31', status: 'Active' },
    { name: 'Mother\'s Day Brunch', description: 'Champagne brunch buffet with floral gift', outletName: 'La Maison Restaurant', validUntil: '2026-03-15', status: 'Active' },
    { name: 'Halloween Themed Night', description: 'Costume dinner with themed cocktails', outletName: 'Sky Lounge Bar', validUntil: '2025-10-31', status: 'Expired' },
    { name: 'Christmas Eve Gala Dinner', description: 'Traditional Christmas dinner with wine pairing', outletName: 'Grand Ballroom Banquet', validUntil: '2026-12-24', status: 'Active' },
  ];

  for (const so of specialOffersData) {
    const existing = await supabaseAdmin.from('fb_special_offers').select('id').eq('name', so.name).maybeSingle();
    if (existing.data) { continue; }
    const outlet = outletByName[so.outletName];
    const { error } = await supabaseAdmin.from('fb_special_offers').insert({
      id: randomUUID(), name: so.name, description: so.description,
      outlet_id: outlet?.id || null, outlet_name: so.outletName,
      valid_until: so.validUntil, status: so.status,
    });
    if (error) { console.error('[SEED] Special offer error:', so.name, error.message); }
    else newSpecialOffers++;
  }

  console.log(`[SEED] Price lists: ${newPriceLists} new, items: ${newPriceListItems} new`);
  console.log(`[SEED] Meal plans: ${newMealPlans} new`);
  console.log(`[SEED] Packages: ${newPackages} new, components: ${newPackageComponents} new, outlets: ${newPackageOutlets} new`);
  console.log(`[SEED] Promotions: ${newPromotions} new`);
  console.log(`[SEED] Special offers: ${newSpecialOffers} new`);
  console.log('[DONE] F&B pricing seed complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
