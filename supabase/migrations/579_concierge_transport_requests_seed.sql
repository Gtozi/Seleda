-- Migration 579: Concierge transportation requests seed
--
-- The Transportation module reads the shared `transport_requests` workflow
-- (source='Concierge'), the same table the Transport & Fleet portal
-- dispatches from. Only two stale July rows existed. These add realistic
-- airport pickups/drop-offs linked to the guests/reservations seeded in
-- migration 575, with guest_id + room populated so the module can link to
-- guest profiles. property_id matches the single installed property.

INSERT INTO transport_requests (
  id, property_id, request_number, guest_id, guest_name, room,
  type, source, pickup_location, destination, scheduled_time,
  passenger_count, luggage_count, status, priority, special_instructions,
  assigned_vehicle, created_at
) VALUES
('a0d00001-0000-4000-8000-000000000001', '18762279-a389-41c9-9169-7ebc682e9703',
 'TR-CONSC-001', 'GST-MOCK-002', 'Bereket Solomon', '09',
 'Airport Pickup', 'Concierge', 'Bole International Airport (ADD)', 'Hotel Main Entrance',
 date_trunc('day', now()) + interval '14 hours',
 2, 3, 'Confirmed', 'High', 'Flight ET302 | VIP arrival — meet at arrivals hall', 'VH-003',
 now() - interval '3 hours'),
('a0d00002-0000-4000-8000-000000000002', '18762279-a389-41c9-9169-7ebc682e9703',
 'TR-CONSC-002', 'GST-MOCK-005', 'Liya Tesfaye', '10',
 'Airport Drop-off', 'Concierge', 'Hotel Main Entrance', 'Bole International Airport (ADD)',
 date_trunc('day', now()) + interval '30 hours',
 1, 2, 'Requested', 'Normal', 'Flight ET815 | allow extra time for shopping',
 NULL, now() - interval '1 hour'),
('a0d00003-0000-4000-8000-000000000003', '18762279-a389-41c9-9169-7ebc682e9703',
 'TR-CONSC-003', 'GST-MOCK-001', 'Aster Demissie', '02',
 'City Transfer', 'Concierge', 'Hotel Main Entrance', 'Merkato Market — spice section',
 date_trunc('day', now()) + interval '9 hours',
 2, 0, 'Assigned', 'Normal', 'Wait-and-return; driver to hold 2 hours', 'VH-001',
 now() - interval '5 hours'),
('a0d00004-0000-4000-8000-000000000004', '18762279-a389-41c9-9169-7ebc682e9703',
 'TR-CONSC-004', 'GST-MOCK-004', 'Dawit Hailu', '06',
 'Airport Drop-off', 'Concierge', 'Hotel Main Entrance', 'Bole International Airport (ADD)',
 date_trunc('day', now()) - interval '4 hours',
 1, 2, 'Completed', 'High', 'Flight ET815 | guest checking out — express drop',
 'VH-002', now() - interval '8 hours'),
('a0d00005-0000-4000-8000-000000000005', '18762279-a389-41c9-9169-7ebc682e9703',
 'TR-CONSC-005', 'GST-MOCK-007', 'Mekdes Araya', '12',
 'Sightseeing Tour', 'Concierge', 'Hotel Main Entrance', 'Entoto Hills — return via National Museum',
 date_trunc('day', now()) + interval '26 hours',
 4, 0, 'Requested', 'Normal', 'Family of 4 — child seat required',
 NULL, now() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;
