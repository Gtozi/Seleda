import '../src/server/env';
import { supabaseAdmin } from '../src/server/supabaseAdmin';
import { randomUUID } from 'crypto';

async function main() {
  if (!supabaseAdmin) { console.error('Supabase not configured'); process.exit(1); }

  // Fetch outlets
  const { data: outlets } = await supabaseAdmin.from('outlets').select('id, name, type').order('name');
  const outletByName: Record<string, any> = {};
  for (const o of outlets || []) outletByName[o.name] = o;

  let newTables = 0, newTableReservations = 0, newWaitlist = 0, newServiceStandards = 0, newGuestRequests = 0;

  // ── Tables ───────────────────────────────────────────────────────
  const tablesData = [
    { tableNumber: 'T-01', outletName: 'La Maison Restaurant', section: 'Main', seats: 2, shape: 'round', status: 'available' },
    { tableNumber: 'T-02', outletName: 'La Maison Restaurant', section: 'Main', seats: 4, shape: 'rectangular', status: 'occupied' },
    { tableNumber: 'T-03', outletName: 'La Maison Restaurant', section: 'Patio', seats: 6, shape: 'rectangular', status: 'occupied' },
    { tableNumber: 'T-04', outletName: 'La Maison Restaurant', section: 'Patio', seats: 4, shape: 'rectangular', status: 'occupied' },
    { tableNumber: 'T-05', outletName: 'La Maison Restaurant', section: 'Main', seats: 2, shape: 'round', status: 'dirty' },
    { tableNumber: 'T-12', outletName: 'La Maison Restaurant', section: 'Private', seats: 8, shape: 'rectangular', status: 'reserved' },
    { tableNumber: 'T-13', outletName: 'La Maison Restaurant', section: 'Main', seats: 4, shape: 'rectangular', status: 'occupied' },
    { tableNumber: 'T-21', outletName: 'Sky Lounge Bar', section: 'Bar', seats: 2, shape: 'round', status: 'available' },
    { tableNumber: 'T-22', outletName: 'Sky Lounge Bar', section: 'Bar', seats: 3, shape: 'oval', status: 'occupied' },
    { tableNumber: 'T-31', outletName: 'MAIN', section: 'Main', seats: 4, shape: 'rectangular', status: 'available' },
    { tableNumber: 'T-32', outletName: 'MAIN', section: 'Main', seats: 6, shape: 'rectangular', status: 'occupied' },
    { tableNumber: 'T-33', outletName: 'MAIN', section: 'Patio', seats: 8, shape: 'rectangular', status: 'available' },
  ];

  for (const t of tablesData) {
    const existing = await supabaseAdmin.from('fb_tables').select('id').eq('table_number', t.tableNumber).maybeSingle();
    if (existing.data) { continue; }
    const outlet = outletByName[t.outletName];
    const { error } = await supabaseAdmin.from('fb_tables').insert({
      table_number: t.tableNumber, seats: t.seats, shape: t.shape,
      section: t.section, outlet_id: outlet?.id || '', status: t.status,
    });
    if (error) { console.error('[SEED] Table error:', t.tableNumber, error.message); }
    else newTables++;
  }

  // ── Table Reservations ───────────────────────────────────────────
  // First fetch all tables to get their IDs
  const { data: allTables } = await supabaseAdmin.from('fb_tables').select('id, table_number, outlet_id').order('table_number');
  const tableByNumber: Record<string, any> = {};
  for (const t of allTables || []) {
    const outlet = outlets?.find(o => o.id === t.outlet_id);
    const key = `${t.table_number}::${outlet?.name || ''}`;
    tableByNumber[key] = t;
  }

  const tableReservationsData = [
    { guestName: 'Anderson, Mr. James', partySize: 2, arrivalTime: '2026-08-12T20:00:00Z', status: 'seated', outletName: 'La Maison Restaurant', tableNumber: 'T-13', specialRequests: 'Anniversary' },
    { guestName: 'Chen, Ms. Lily', partySize: 4, arrivalTime: '2026-08-12T19:30:00Z', status: 'seated', outletName: 'La Maison Restaurant', tableNumber: 'T-03' },
    { guestName: 'Patel, Dr. Ravi', partySize: 6, arrivalTime: '2026-08-12T21:00:00Z', status: 'confirmed', outletName: 'La Maison Restaurant', tableNumber: 'T-12', specialRequests: 'VIP — window seat' },
    { guestName: 'Garcia, Mrs. Elena', partySize: 2, arrivalTime: '2026-08-12T19:00:00Z', status: 'no_show', outletName: 'La Maison Restaurant', tableNumber: 'T-02' },
    { guestName: 'Walker, Mr. Tom', partySize: 3, arrivalTime: '2026-08-13T18:30:00Z', status: 'confirmed', outletName: 'Sky Lounge Bar', tableNumber: 'T-22' },
    { guestName: 'Nakamura, Ms. Yui', partySize: 2, arrivalTime: '2026-08-13T20:30:00Z', status: 'confirmed', outletName: 'La Maison Restaurant', tableNumber: 'T-01' },
  ];

  for (const r of tableReservationsData) {
    const existing = await supabaseAdmin.from('fb_table_reservations').select('id').eq('guest_name', r.guestName).eq('arrival_time', r.arrivalTime).maybeSingle();
    if (existing.data) { continue; }
    const tableKey = `${r.tableNumber}::${r.outletName}`;
    const table = tableByNumber[tableKey];
    const { error } = await supabaseAdmin.from('fb_table_reservations').insert({
      guest_name: r.guestName, party_size: r.partySize, arrival_time: r.arrivalTime,
      status: r.status, special_requests: r.specialRequests || null, table_id: table?.id || null,
    });
    if (error) { console.error('[SEED] Table reservation error:', r.guestName, error.message); }
    else newTableReservations++;
  }

  // ── Waitlist ───────────────────────────────────────────────────────
  const waitlistData = [
    { guestName: 'Brown, Mr. Kevin', partySize: 2, contactPhone: '+1 555-0677', estimatedWaitTime: 15, outletName: 'La Maison Restaurant', status: 'waiting' },
    { guestName: 'Rossi, Ms. Sofia', partySize: 4, contactPhone: '+1 555-0688', estimatedWaitTime: 25, outletName: 'La Maison Restaurant', status: 'waiting' },
    { guestName: 'Khan, Mr. Omar', partySize: 5, contactPhone: '+1 555-0699', estimatedWaitTime: 10, outletName: 'Sky Lounge Bar', status: 'waiting' },
    { guestName: 'Müller, Ms. Anna', partySize: 2, contactPhone: '+1 555-0710', estimatedWaitTime: 20, outletName: 'La Maison Restaurant', seated: true, status: 'seated' },
    { guestName: 'Silva, Mr. Pedro', partySize: 3, contactPhone: '+1 555-0722', estimatedWaitTime: 30, outletName: 'Sky Lounge Bar', cancelled: true, status: 'left' },
  ];

  for (const w of waitlistData) {
    const existing = await supabaseAdmin.from('fb_waitlist').select('id').eq('guest_name', w.guestName).maybeSingle();
    if (existing.data) { continue; }
    const outlet = outletByName[w.outletName];
    const { error } = await supabaseAdmin.from('fb_waitlist').insert({
      guest_name: w.guestName, party_size: w.partySize, contact_phone: w.contactPhone,
      estimated_wait_time: w.estimatedWaitTime, seated: w.seated || false, cancelled: w.cancelled || false,
      notes: w.status === 'left' ? 'Left without being seated' : null,
    });
    if (error) { console.error('[SEED] Waitlist error:', w.guestName, error.message); }
    else newWaitlist++;
  }

  // ── Service Standards ───────────────────────────────────────────────
  const serviceStandardsData = [
    { name: 'Greeting Time', targetValue: '< 30 sec', actualValue: '22 sec', unit: 'sec', status: 'Meeting', outletName: 'La Maison Restaurant' },
    { name: 'Order Taken Within', targetValue: '< 5 min', actualValue: '4 min 10 sec', unit: 'min', status: 'Meeting', outletName: 'La Maison Restaurant' },
    { name: 'First Course Served', targetValue: '< 15 min', actualValue: '18 min', unit: 'min', status: 'Below', outletName: 'La Maison Restaurant' },
    { name: 'Table Turnover', targetValue: '< 90 min', actualValue: '78 min', unit: 'min', status: 'Exceeded', outletName: 'La Maison Restaurant' },
    { name: 'Bill Delivery', targetValue: '< 5 min', actualValue: '6 min 30 sec', unit: 'min', status: 'Below', outletName: 'La Maison Restaurant' },
    { name: 'Order Accuracy', targetValue: '> 98%', actualValue: '96.4%', unit: '%', status: 'Below', outletName: 'La Maison Restaurant' },
    { name: 'Greeting Time', targetValue: '< 30 sec', actualValue: '18 sec', unit: 'sec', status: 'Exceeded', outletName: 'Sky Lounge Bar' },
    { name: 'Order Taken Within', targetValue: '< 5 min', actualValue: '3 min 45 sec', unit: 'min', status: 'Exceeded', outletName: 'Sky Lounge Bar' },
  ];

  for (const ss of serviceStandardsData) {
    const existing = await supabaseAdmin.from('fb_service_standards').select('id').eq('name', ss.name).eq('measured_at', new Date().toISOString().split('T')[0]).maybeSingle();
    if (existing.data) { continue; }
    const outlet = outletByName[ss.outletName];
    const { error } = await supabaseAdmin.from('fb_service_standards').insert({
      id: randomUUID(), name: ss.name, target_value: ss.targetValue, actual_value: ss.actualValue,
      unit: ss.unit, status: ss.status, outlet_id: outlet?.id || null,
      measured_at: new Date().toISOString().split('T')[0],
    });
    if (error) { console.error('[SEED] Service standard error:', ss.name, error.message); }
    else newServiceStandards++;
  }

  // ── F&B Guest Requests ─────────────────────────────────────────────
  const guestRequestsData = [
    { guestName: 'Anderson, Mr. James', roomNumber: '412', outletName: 'La Maison Restaurant', request: 'Birthday cake surprise for dessert', priority: 'High', status: 'In Progress' },
    { guestName: 'Chen, Ms. Lily', outletName: 'La Maison Restaurant', request: 'High chair for toddler', priority: 'Medium', status: 'Resolved' },
    { guestName: 'Patel, Dr. Ravi', outletName: 'La Maison Restaurant', request: 'Gluten-free menu options', priority: 'High', status: 'Open' },
    { guestName: 'Walker, Mr. Tom', outletName: 'Sky Lounge Bar', request: 'Quiet corner table', priority: 'Low', status: 'Open' },
    { guestName: 'Garcia, Mrs. Elena', outletName: 'MAIN', request: 'Vegan dietary requirements', priority: 'Medium', status: 'Open' },
  ];

  for (const gr of guestRequestsData) {
    const existing = await supabaseAdmin.from('fb_guest_requests').select('id').eq('guest_name', gr.guestName).eq('request', gr.request).maybeSingle();
    if (existing.data) { continue; }
    const outlet = outletByName[gr.outletName];
    const { error } = await supabaseAdmin.from('fb_guest_requests').insert({
      id: randomUUID(), guest_name: gr.guestName, room_number: gr.roomNumber || null,
      outlet_id: outlet?.id || null, outlet_name: gr.outletName, request: gr.request,
      priority: gr.priority, status: gr.status,
    });
    if (error) { console.error('[SEED] Guest request error:', gr.guestName, error.message); }
    else newGuestRequests++;
  }

  console.log(`[SEED] Tables: ${newTables} new`);
  console.log(`[SEED] Table reservations: ${newTableReservations} new`);
  console.log(`[SEED] Waitlist: ${newWaitlist} new`);
  console.log(`[SEED] Service standards: ${newServiceStandards} new`);
  console.log(`[SEED] F&B guest requests: ${newGuestRequests} new`);
  console.log('[DONE] F&B service operations seed complete.');
}

main().catch(err => { console.error(err); process.exit(1); });