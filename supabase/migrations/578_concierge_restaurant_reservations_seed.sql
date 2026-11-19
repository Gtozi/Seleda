-- Migration 578: Concierge restaurant reservations seed
--
-- The Restaurant Reservations module reads booking requests from
-- guest_requests (request_type='Restaurant Booking'). The venue list comes
-- from the real `outlets` table (already populated: La Maison Restaurant,
-- Sky Lounge Bar, Grand Ballroom Banquet, etc.). These rows add
-- reservation-linked dinner bookings for the in-house/arriving guests
-- seeded in migration 575 so the module has a lively, realistic list.

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-DINE-001', 'REQ-DINE-0001', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Restaurant Booking', 'La Maison Restaurant · Tonight 19:30 · 2 guests · window table', 'Normal', 'Assigned',
 'Mia Johnson', 'Concierge', 'Anniversary — discreet candle on the table.',
 now() - interval '2 hours', now() - interval '90 minutes', NULL, NULL, NULL),
('REQ-DINE-002', 'REQ-DINE-0002', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Restaurant Booking', 'Sky Lounge Bar · Tomorrow 20:00 · 4 guests · terrace seating', 'Normal', 'Open',
 NULL, 'Concierge', 'One vegetarian; prefers quiet corner.',
 now() - interval '3 hours', NULL, NULL, NULL, NULL),
('REQ-DINE-003', 'REQ-DINE-0003', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Restaurant Booking', 'Grand Ballroom Banquet · Friday 13:00 · 6 guests · family lunch', 'High', 'In Progress',
 'Mia Johnson', 'Concierge', 'High chair needed for toddler.',
 now() - interval '5 hours', now() - interval '4 hours', NULL, NULL, NULL),
('REQ-DINE-004', 'REQ-DINE-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Restaurant Booking', 'La Maison Restaurant · Today 12:30 · 1 guest · express lunch before checkout', 'High', 'Completed',
 'Mia Johnson', 'Concierge', 'Guest checking out — needs bill to room.',
 now() - interval '26 hours', now() - interval '25 hours', now() - interval '20 hours', 5,
 'Fast service, exactly on time for checkout.'),
('REQ-DINE-005', 'REQ-DINE-0005', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Restaurant Booking', 'La Maison Restaurant · Arrival evening 20:30 · 2 guests · tasting menu', 'Normal', 'Open',
 NULL, 'Concierge', 'VIP arrival — offer welcome drink.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
