import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function seed() {
  if (!supabaseAdmin) { console.error('Supabase not configured'); process.exit(1); }
  console.log('[SEED] Starting F&B room service seed...');

  // Fetch outlets and menu items
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name').order('name');
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('id, name').limit(20);

  const outletByName: Record<string, string> = {};
  for (const o of outlets || []) outletByName[o.name] = o.id;

  const roomServiceOutletId = outletByName['Room Service'];
  if (!roomServiceOutletId) {
    console.error('[SEED] Room Service outlet not found');
    process.exit(1);
  }

  // Seed Room Service Menu Items
  console.log('[SEED] Seeding room service menu items...');
  const menuItemsToSeed = menuItems?.slice(0, 8) || [];
  const rsMenuItems = menuItemsToSeed.map(mi => ({
    menu_item_id: mi.id,
    outlet_id: roomServiceOutletId,
    is_available_24h: true,
    is_active: true,
  }));

  const { data: existingRSMenuItems } = await supabaseAdmin.from('fb_room_service_menu_items').select('menu_item_id');
  const rsMenuKeys = new Set(existingRSMenuItems?.map(m => m.menu_item_id) || []);
  const newRSMenuItems = rsMenuItems.filter(m => !rsMenuKeys.has(m.menu_item_id));

  if (newRSMenuItems.length > 0) {
    const { error } = await supabaseAdmin.from('fb_room_service_menu_items').insert(newRSMenuItems);
    if (error) throw error;
    console.log(`[SEED] Room service menu items: ${newRSMenuItems.length} new`);
  } else {
    console.log('[SEED] Room service menu items: 0 new');
  }

  // Seed Room Service Orders
  console.log('[SEED] Seeding room service orders...');
  const rsOrders = [
    {
      room_number: '101',
      guest_name: 'John Doe',
      order_type: 'Immediate',
      total_amount: 45.00,
      special_instructions: 'No ice in drinks',
      status: 'Delivered',
      charge_to_room: true,
    },
    {
      room_number: '205',
      guest_name: 'Jane Smith',
      order_type: 'Scheduled',
      scheduled_for: new Date(Date.now() + 3600000).toISOString(),
      total_amount: 78.50,
      special_instructions: 'Deliver at 7:00 PM',
      status: 'Pending',
      charge_to_room: true,
    },
    {
      room_number: '312',
      guest_name: 'Bob Johnson',
      order_type: 'Immediate',
      total_amount: 32.00,
      special_instructions: null,
      status: 'In Progress',
      charge_to_room: true,
    },
  ];

  const { data: existingRSOrders } = await supabaseAdmin.from('fb_room_service_orders').select('room_number, guest_name');
  const rsOrderKeys = new Set(existingRSOrders?.map(o => `${o.room_number}-${o.guest_name}`) || []);
  const newRSOrders = rsOrders.filter(o => !rsOrderKeys.has(`${o.room_number}-${o.guest_name}`));

  if (newRSOrders.length > 0) {
    const { data: insertedRSOrders } = await supabaseAdmin.from('fb_room_service_orders').insert(newRSOrders).select();
    console.log(`[SEED] Room service orders: ${newRSOrders.length} new`);
  } else {
    console.log('[SEED] Room service orders: 0 new');
  }

  // Seed Room Service Deliveries
  console.log('[SEED] Seeding room service deliveries...');
  const { data: allRSOrders } = await supabaseAdmin.from('fb_room_service_orders').select('id');
  if (allRSOrders && allRSOrders.length > 0) {
    const rsDeliveries = [
      {
        room_service_order_id: allRSOrders[0]?.id,
        assigned_to: 'Staff Member 1',
        status: 'Delivered',
        picked_up_at: new Date(Date.now() - 1800000).toISOString(),
        delivered_at: new Date(Date.now() - 900000).toISOString(),
        delivery_notes: 'Delivered on time',
      },
    ];

    const { data: existingRSDeliveries } = await supabaseAdmin.from('fb_room_service_deliveries').select('room_service_order_id');
    const rsDeliveryKeys = new Set(existingRSDeliveries?.map(d => d.room_service_order_id) || []);
    const newRSDeliveries = rsDeliveries.filter(d => d.room_service_order_id && !rsDeliveryKeys.has(d.room_service_order_id));

    if (newRSDeliveries.length > 0) {
      const { error } = await supabaseAdmin.from('fb_room_service_deliveries').insert(newRSDeliveries);
      if (error) throw error;
      console.log(`[SEED] Room service deliveries: ${newRSDeliveries.length} new`);
    } else {
      console.log('[SEED] Room service deliveries: 0 new');
    }
  } else {
    console.log('[SEED] Room service deliveries: 0 new (no orders found)');
  }

  // Seed Room Service Guest Preferences
  console.log('[SEED] Seeding room service guest preferences...');
  const guestPreferences = [
    {
      room_number: '101',
      dietary_restrictions: ['Vegetarian'],
      preferred_temperature: 'Hot',
      special_requests: 'Extra napkins',
      notes: 'Regular guest',
    },
    {
      room_number: '205',
      dietary_restrictions: ['Gluten-Free'],
      preferred_temperature: 'Warm',
      special_requests: null,
      notes: null,
    },
  ];

  const { data: existingGuestPrefs } = await supabaseAdmin.from('fb_room_service_guest_preferences').select('room_number');
  const guestPrefKeys = new Set(existingGuestPrefs?.map(p => p.room_number) || []);
  const newGuestPrefs = guestPreferences.filter(p => !guestPrefKeys.has(p.room_number));

  if (newGuestPrefs.length > 0) {
    const { error } = await supabaseAdmin.from('fb_room_service_guest_preferences').insert(newGuestPrefs);
    if (error) throw error;
    console.log(`[SEED] Guest preferences: ${newGuestPrefs.length} new`);
  } else {
    console.log('[SEED] Guest preferences: 0 new');
  }

  // Seed Minibar Inventory
  console.log('[SEED] Seeding minibar inventory...');
  const minibarItems = menuItems?.slice(0, 5) || [];
  const rooms = ['101', '102', '103', '201', '202', '203', '301', '302', '303'];
  const minibarInventory: any[] = [];
  for (const room of rooms) {
    for (const item of minibarItems) {
      minibarInventory.push({
        room_number: room,
        menu_item_id: item.id,
        current_stock: Math.floor(Math.random() * 5) + 1,
        max_stock: 5,
        is_active: true,
      });
    }
  }

  const { data: existingMinibar } = await supabaseAdmin.from('fb_minibar_inventory').select('room_number, menu_item_id');
  const minibarKeys = new Set(existingMinibar?.map(m => `${m.room_number}-${m.menu_item_id}`) || []);
  const newMinibar = minibarInventory.filter(m => !minibarKeys.has(`${m.room_number}-${m.menu_item_id}`));

  if (newMinibar.length > 0) {
    const { error } = await supabaseAdmin.from('fb_minibar_inventory').insert(newMinibar);
    if (error) throw error;
    console.log(`[SEED] Minibar inventory: ${newMinibar.length} new`);
  } else {
    console.log('[SEED] Minibar inventory: 0 new');
  }

  // Seed Minibar Consumption
  console.log('[SEED] Seeding minibar consumption...');
  const minibarConsumption = [
    {
      room_number: '101',
      menu_item_id: minibarItems[0]?.id,
      quantity: 2,
      unit_price: 5.00,
      total_amount: 10.00,
      charged_to_folio: true,
    },
    {
      room_number: '201',
      menu_item_id: minibarItems[1]?.id,
      quantity: 1,
      unit_price: 8.00,
      total_amount: 8.00,
      charged_to_folio: true,
    },
  ];

  const { data: existingConsumption } = await supabaseAdmin.from('fb_minibar_consumption').select('room_number, menu_item_id, consumed_at');
  const consumptionKeys = new Set(existingConsumption?.map(c => `${c.room_number}-${c.menu_item_id}-${c.consumed_at}`) || []);
  const newConsumption = minibarConsumption.filter(c => !consumptionKeys.has(`${c.room_number}-${c.menu_item_id}-${c.consumed_at}`));

  if (newConsumption.length > 0) {
    const { error } = await supabaseAdmin.from('fb_minibar_consumption').insert(newConsumption);
    if (error) throw error;
    console.log(`[SEED] Minibar consumption: ${newConsumption.length} new`);
  } else {
    console.log('[SEED] Minibar consumption: 0 new');
  }

  console.log('[DONE] F&B room service seed complete.');
}

seed().catch(console.error);