-- Migration 580: Concierge tour catalog + bookings seed
--
-- The Tour & Excursion Management module reads the bookable tour catalog
-- from `guest_services` filtered by category='tour' (distinct from the
-- in-city 'concierge' experiences seeded in migration 577) and bookings
-- from guest_requests (request_type='Tour Booking'). These rows add
-- multi-day excursions plus reservation-linked tour bookings for the
-- guests seeded in migration 575.

-- ── Allow the 'tour' service category (multi-day excursions) ──────────────
ALTER TABLE guest_services DROP CONSTRAINT IF EXISTS guest_services_category_check;
ALTER TABLE guest_services ADD CONSTRAINT guest_services_category_check
  CHECK (category = ANY (ARRAY['dining','transportation','laundry','spa','room_service','concierge','tour']));

-- ── Multi-day tour catalog ────────────────────────────────────────────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
('gs_tour_01', 'Lalibela Churches — 2 Days', 'Fly-in tour of the rock-hewn churches of Lalibela, a UNESCO World Heritage site. Flights, guide, hotel, and meals included.', 'tour', 850.00, true),
('gs_tour_02', 'Simien Mountains Trek — 3 Days', 'Guided trek through the Simien Mountains with gelada baboon viewing, Jinbar waterfall, and two nights in Sankaber camp. Jeep transfer included.', 'tour', 620.00, true),
('gs_tour_03', 'Danakil Depression Expedition — 4 Days', 'Expedition to Erta Ale volcano and the Dallol sulfur springs with a convoy and armed escort. Extreme conditions — advance booking required.', 'tour', 1400.00, true),
('gs_tour_04', 'Omo Valley Cultural Tour — 5 Days', 'Cultural immersion visiting Hamar, Mursi, and Kara communities in the Lower Omo Valley with photographer guide.', 'tour', 1650.00, true),
('gs_tour_05', 'Harar & Dire Dawa — 2 Days', 'Walled city of Harar — hyena feeding, Rimbaud house, coffee at a traditional harari home. Train or flight options.', 'tour', 480.00, true),
('gs_tour_06', 'Rift Valley Lakes Circuit — 2 Days', 'Langano, Abijatta-Shalla, and Awassa — flamingos, hot springs, and lakeside resorts.', 'tour', 380.00, true),
('gs_tour_07', 'Gondar Castles Day Excursion', 'Fly north for the Fasil Ghebbi royal enclosure and Debre Birhan Selassie church, famous for its painted angel ceiling.', 'tour', 420.00, false)
ON CONFLICT (id) DO NOTHING;

-- ── Tour booking requests linked to seeded guests ─────────────────────────
INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-TOUR-001', 'REQ-TOUR-0001', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Tour Booking', 'Lalibela Churches — 2 Days · Departure Saturday · 2 participants', 'High', 'Assigned',
 'Mia Johnson', 'Concierge', 'Confirm flight seats on ET120; vegetarian meals.',
 now() - interval '4 hours', now() - interval '3 hours', NULL, NULL, NULL),
('REQ-TOUR-002', 'REQ-TOUR-0002', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Tour Booking', 'Rift Valley Lakes Circuit — 2 Days · Next weekend · 4 participants', 'Normal', 'Open',
 NULL, 'Concierge', 'Family trip — needs a 7-seat vehicle.',
 now() - interval '2 hours', NULL, NULL, NULL, NULL),
('REQ-TOUR-003', 'REQ-TOUR-0003', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Tour Booking', 'Simien Mountains Trek — 3 Days · Dates flexible next week · 2 participants', 'Normal', 'In Progress',
 'Mia Johnson', 'Concierge', 'VIP — arrange private guide and upgraded camp.',
 now() - interval '6 hours', now() - interval '5 hours', NULL, NULL, NULL),
('REQ-TOUR-004', 'REQ-TOUR-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Tour Booking', 'Gondar Castles Day Excursion · Completed before departure · 1 participant', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge', NULL,
 now() - interval '50 hours', now() - interval '48 hours', now() - interval '30 hours', 4,
 'Wonderful guide — the angel ceiling is unforgettable.'),
('REQ-TOUR-005', 'REQ-TOUR-0005', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Tour Booking', 'Harar & Dire Dawa — 2 Days · Mid-week · 2 participants', 'Low', 'Open',
 NULL, 'Concierge', 'Interested in the hyena feeding experience.',
 now() - interval '8 hours', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
