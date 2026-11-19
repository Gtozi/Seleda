import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

async function seed() {
  if (!supabaseAdmin) { console.error('Supabase not configured'); process.exit(1); }
  console.log('[SEED] Starting production coordination seed...');

  // Fetch outlets
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name').order('name');
  const outletByName: Record<string, string> = {};
  for (const o of outlets || []) outletByName[o.name] = o.id;

  // Seed KDS Stations
  console.log('[SEED] Seeding KDS stations...');
  const stations = [
    { name: 'Grill', outlet_id: outletByName['La Maison Restaurant'], status: 'Online', open_tickets: 7, avg_ticket_time: '12 min', load: 78 },
    { name: 'Fry', outlet_id: outletByName['La Maison Restaurant'], status: 'Online', open_tickets: 4, avg_ticket_time: '8 min', load: 45 },
    { name: 'Cold', outlet_id: outletByName['La Maison Restaurant'], status: 'Online', open_tickets: 3, avg_ticket_time: '5 min', load: 32 },
    { name: 'Pizza', outlet_id: outletByName['La Maison Restaurant'], status: 'Online', open_tickets: 5, avg_ticket_time: '14 min', load: 62 },
    { name: 'Pastry', outlet_id: outletByName['La Maison Restaurant'], status: 'Maintenance', open_tickets: 0, avg_ticket_time: '—', load: 0 },
    { name: 'Expo', outlet_id: outletByName['La Maison Restaurant'], status: 'Online', open_tickets: 9, avg_ticket_time: '3 min', load: 55 },
    { name: 'Bar', outlet_id: outletByName['Sky Lounge Bar'], status: 'Offline', open_tickets: 0, avg_ticket_time: '—', load: 0 },
  ].filter(s => s.outlet_id);

  const { data: existingStations } = await supabaseAdmin.from('fb_kds_stations').select('name, outlet_id');
  const stationKeys = new Set(existingStations?.map(s => `${s.name}-${s.outlet_id}`) || []);
  const newStations = stations.filter(s => !stationKeys.has(`${s.name}-${s.outlet_id}`));

  if (newStations.length > 0) {
    const { error } = await supabaseAdmin.from('fb_kds_stations').insert(newStations);
    if (error) throw error;
    console.log(`[SEED] KDS stations: ${newStations.length} new`);
  } else {
    console.log('[SEED] KDS stations: 0 new');
  }

  // Get station IDs for tickets
  const { data: allStations } = await supabaseAdmin.from('fb_kds_stations').select('*');
  const stationMap = new Map(allStations?.map(s => [s.name, s.id]) || []);

  // Seed KDS Tickets
  console.log('[SEED] Seeding KDS tickets...');
  const tickets = [
    { order_id: 'ORD-1024', outlet_id: outletByName['La Maison Restaurant'], station_id: stationMap.get('Grill'), items: 3, status: 'In Progress', age: '4 min' },
    { order_id: 'ORD-1025', outlet_id: outletByName['La Maison Restaurant'], station_id: stationMap.get('Grill'), items: 5, status: 'Queued', age: '1 min' },
    { order_id: 'ORD-1031', outlet_id: outletByName['La Maison Restaurant'], station_id: stationMap.get('Pizza'), items: 2, status: 'Ready', age: '11 min' },
    { order_id: 'ORD-1040', outlet_id: outletByName['Sky Lounge Bar'], station_id: stationMap.get('Cold'), items: 4, status: 'Served', age: '0 min' },
    { order_id: 'ORD-1041', outlet_id: outletByName['La Maison Restaurant'], station_id: stationMap.get('Fry'), items: 6, status: 'In Progress', age: '6 min' },
    { order_id: 'ORD-1042', outlet_id: outletByName['La Maison Restaurant'], station_id: stationMap.get('Expo'), items: 2, status: 'Queued', age: '2 min' },
  ].filter(t => t.station_id);

  const { data: existingTickets } = await supabaseAdmin.from('fb_kds_tickets').select('order_id');
  const ticketKeys = new Set(existingTickets?.map(t => t.order_id) || []);
  const newTickets = tickets.filter(t => !ticketKeys.has(t.order_id));

  if (newTickets.length > 0) {
    const { error } = await supabaseAdmin.from('fb_kds_tickets').insert(newTickets);
    if (error) throw error;
    console.log(`[SEED] KDS tickets: ${newTickets.length} new`);
  } else {
    console.log('[SEED] KDS tickets: 0 new');
  }

  // Seed Production Plans
  console.log('[SEED] Seeding production plans...');
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const plans = [
    { outlet_id: outletByName['La Maison Restaurant'], plan_date: today, meal_period: 'Breakfast', forecast_covers: 120, status: 'Completed' },
    { outlet_id: outletByName['La Maison Restaurant'], plan_date: today, meal_period: 'Lunch', forecast_covers: 85, status: 'Completed' },
    { outlet_id: outletByName['La Maison Restaurant'], plan_date: today, meal_period: 'Dinner', forecast_covers: 140, status: 'In Progress' },
    { outlet_id: outletByName['La Maison Restaurant'], plan_date: today, meal_period: 'Dinner', forecast_covers: 60, status: 'In Progress' },
    { outlet_id: outletByName['Room Service'], plan_date: today, meal_period: 'All Day', forecast_covers: 45, status: 'In Progress' },
    { outlet_id: outletByName['La Maison Restaurant'], plan_date: tomorrow, meal_period: 'Breakfast', forecast_covers: 130, status: 'Planned' },
  ].filter(p => p.outlet_id);

  const { data: existingPlans } = await supabaseAdmin.from('fb_production_plans').select('outlet_id, plan_date, meal_period');
  const planKeys = new Set(existingPlans?.map(p => `${p.outlet_id}-${p.plan_date}-${p.meal_period}`) || []);
  const newPlans = plans.filter(p => !planKeys.has(`${p.outlet_id}-${p.plan_date}-${p.meal_period}`));

  if (newPlans.length > 0) {
    const { error } = await supabaseAdmin.from('fb_production_plans').insert(newPlans);
    if (error) throw error;
    console.log(`[SEED] Production plans: ${newPlans.length} new`);
  } else {
    console.log('[SEED] Production plans: 0 new');
  }

  // Seed Prep Items
  console.log('[SEED] Seeding prep items...');
  const prepItems = [
    { name: 'Tomato Sauce', outlet_id: outletByName['La Maison Restaurant'], station: 'Cold', qty: 10, unit: 'L', assignee: 'Chef Marco', due_by: '16:00', status: 'Ready' },
    { name: 'Pizza Dough', outlet_id: outletByName['La Maison Restaurant'], station: 'Pizza', qty: 25, unit: 'kg', assignee: 'Chef Luca', due_by: '15:30', status: 'In Progress' },
    { name: 'Chopped Onions', outlet_id: outletByName['La Maison Restaurant'], station: 'Cold', qty: 8, unit: 'kg', assignee: 'Cook Sara', due_by: '14:00', status: 'Ready' },
    { name: 'Grilled Chicken', outlet_id: outletByName['La Maison Restaurant'], station: 'Grill', qty: 30, unit: 'portions', assignee: 'Chef Ana', due_by: '17:00', status: 'Pending' },
    { name: 'Caramelized Onion', outlet_id: outletByName['La Maison Restaurant'], station: 'Cold', qty: 5, unit: 'kg', assignee: 'Cook Sara', due_by: '16:30', status: 'Pending' },
    { name: 'Beef Stock', outlet_id: outletByName['La Maison Restaurant'], station: 'Cold', qty: 15, unit: 'L', assignee: 'Chef Marco', due_by: '18:00', status: 'In Progress' },
  ].filter(p => p.outlet_id);

  const { data: existingPrep } = await supabaseAdmin.from('fb_prep_items').select('name, outlet_id');
  const prepKeys = new Set(existingPrep?.map(p => `${p.name}-${p.outlet_id}`) || []);
  const newPrep = prepItems.filter(p => !prepKeys.has(`${p.name}-${p.outlet_id}`));

  if (newPrep.length > 0) {
    const { error } = await supabaseAdmin.from('fb_prep_items').insert(newPrep);
    if (error) throw error;
    console.log(`[SEED] Prep items: ${newPrep.length} new`);
  } else {
    console.log('[SEED] Prep items: 0 new');
  }

  // Seed Batch Production
  console.log('[SEED] Seeding batch production...');
  const batches = [
    { name: 'Chicken Stock', outlet_id: outletByName['La Maison Restaurant'], batch_type: 'Stock', yield_qty: 20, yield_unit: 'L', prepared_by: 'Chef Marco', status: 'Ready' },
    { name: 'Velouté Sauce', outlet_id: outletByName['La Maison Restaurant'], batch_type: 'Sauce', yield_qty: 8, yield_unit: 'L', prepared_by: 'Chef Luca', status: 'Cooking' },
    { name: 'Tomato Basil Soup', outlet_id: outletByName['La Maison Restaurant'], batch_type: 'Soup', yield_qty: 25, yield_unit: 'L', prepared_by: 'Chef Ana', status: 'Ready' },
    { name: 'Brioche Dough', outlet_id: outletByName['La Maison Restaurant'], batch_type: 'Dough', yield_qty: 12, yield_unit: 'kg', prepared_by: 'Chef Luca', status: 'Scheduled' },
    { name: 'Crème Brûlée Base', outlet_id: outletByName['La Maison Restaurant'], batch_type: 'Dessert Base', yield_qty: 40, yield_unit: 'portions', prepared_by: 'Chef Marco', status: 'Used' },
    { name: 'Lemon Marinade', outlet_id: outletByName['La Maison Restaurant'], batch_type: 'Marinade', yield_qty: 6, yield_unit: 'L', prepared_by: 'Cook Sara', status: 'Ready' },
  ].filter(b => b.outlet_id);

  const { data: existingBatches } = await supabaseAdmin.from('fb_batch_production').select('name, outlet_id');
  const batchKeys = new Set(existingBatches?.map(b => `${b.name}-${b.outlet_id}`) || []);
  const newBatches = batches.filter(b => !batchKeys.has(`${b.name}-${b.outlet_id}`));

  if (newBatches.length > 0) {
    const { error } = await supabaseAdmin.from('fb_batch_production').insert(newBatches);
    if (error) throw error;
    console.log(`[SEED] Batch production: ${newBatches.length} new`);
  } else {
    console.log('[SEED] Batch production: 0 new');
  }

  // Seed Kitchen Messages
  console.log('[SEED] Seeding kitchen messages...');
  const messages = [
    { from_station: 'Expo', to_station: 'Grill', message: 'Push the ribeye on TKT-1001 — VIP table waiting', priority: 'Urgent', message_time: '20:31' },
    { from_station: 'F&B Manager', to_station: 'All Stations', message: '86 the sea bass — out of stock', priority: 'Urgent', message_time: '20:15' },
    { from_station: 'Cold', to_station: 'Expo', message: 'Salad for ORD-1025 plated, holding', priority: 'Info', message_time: '20:28' },
    { from_station: 'Pastry', to_station: 'Expo', message: 'Dessert station back online after maintenance', priority: 'Info', message_time: '20:05' },
  ];

  const { data: existingMessages } = await supabaseAdmin.from('fb_kitchen_messages').select('message, message_time');
  const messageKeys = new Set(existingMessages?.map(m => `${m.message}-${m.message_time}`) || []);
  const newMessages = messages.filter(m => !messageKeys.has(`${m.message}-${m.message_time}`));

  if (newMessages.length > 0) {
    const { error } = await supabaseAdmin.from('fb_kitchen_messages').insert(newMessages);
    if (error) throw error;
    console.log(`[SEED] Kitchen messages: ${newMessages.length} new`);
  } else {
    console.log('[SEED] Kitchen messages: 0 new');
  }

  console.log('[DONE] F&B production coordination seed complete.');
}

seed().catch(console.error);