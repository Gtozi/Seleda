-- Migration 581: Concierge ticketing catalog + bookings seed
--
-- The Ticketing Services module reads the ticketable-items catalog from
-- `guest_services` (category='ticketing') and issued-ticket requests from
-- guest_requests (request_type='Ticket Booking'). The category constraint
-- already allows 'tour' from migration 580; extend it once more for
-- 'ticketing', then seed the catalog and reservation-linked bookings.

ALTER TABLE guest_services DROP CONSTRAINT IF EXISTS guest_services_category_check;
ALTER TABLE guest_services ADD CONSTRAINT guest_services_category_check
  CHECK (category = ANY (ARRAY['dining','transportation','laundry','spa','room_service','concierge','tour','ticketing']));

-- ── Ticketable items catalog ──────────────────────────────────────────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
('gs_tkt_01', 'National Museum Entry', 'General admission to the National Museum of Ethiopia, including the Lucy exhibit. Open daily 08:30–17:30.', 'ticketing', 5.00, true),
('gs_tkt_02', 'Unity Park Entry', 'Admission to Unity Park — imperial palace grounds, zoo, and historical exhibits. Guided add-on available.', 'ticketing', 20.00, true),
('gs_tkt_03', 'Ethnological Museum Entry', 'Admission to the Institute of Ethiopian Studies museum at Addis Ababa University, Sidist Kilo.', 'ticketing', 8.00, true),
('gs_tkt_04', 'Traditional Music Evening — Fendika', 'Evening azmari-bet performance with traditional music and dance. Friday & Saturday, 20:00.', 'ticketing', 15.00, true),
('gs_tkt_05', 'National Theatre Performance', 'Reserved seating for current production at the Ethiopian National Theatre. Schedule varies weekly.', 'ticketing', 25.00, true),
('gs_tkt_06', 'Addis International Film Festival Pass', 'Day pass for screenings at the Addis International Film Festival. Seasonal availability.', 'ticketing', 30.00, false),
('gs_tkt_07', 'Flight Booking Assistance', 'Concierge-assisted domestic flight booking — Ethiopian Airlines to Lalibela, Axum, Bahir Dar, and more.', 'ticketing', 10.00, true)
ON CONFLICT (id) DO NOTHING;

-- ── Ticket bookings linked to seeded guests ───────────────────────────────
INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-TKT-001', 'REQ-TKT-0001', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Ticket Booking', 'Traditional Music Evening — Fendika · Friday 20:00 · 2 tickets', 'Normal', 'Assigned',
 'Mia Johnson', 'Concierge', 'Request front-row table if available.',
 now() - interval '3 hours', now() - interval '2 hours', NULL, NULL, NULL),
('REQ-TKT-002', 'REQ-TKT-0002', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Ticket Booking', 'Unity Park Entry · Tomorrow morning · 3 tickets', 'Normal', 'Open',
 NULL, 'Concierge', 'Kids under 12 — confirm child pricing.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL),
('REQ-TKT-003', 'REQ-TKT-0003', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Ticket Booking', 'Flight Booking Assistance · Addis → Lalibela · Saturday · 2 seats', 'High', 'In Progress',
 'Mia Johnson', 'Concierge', 'VIP — window seats, business class preferred.',
 now() - interval '5 hours', now() - interval '4 hours', NULL, NULL, NULL),
('REQ-TKT-004', 'REQ-TKT-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Ticket Booking', 'National Theatre Performance · Completed · 1 ticket', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge', NULL,
 now() - interval '40 hours', now() - interval '38 hours', now() - interval '30 hours', 5,
 'Excellent show — great seat selection.'),
('REQ-TKT-005', 'REQ-TKT-0005', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Ticket Booking', 'National Museum Entry · Today · 4 tickets', 'Normal', 'Open',
 NULL, 'Concierge', 'Wants tickets ready at the desk before 14:00.',
 now() - interval '45 minutes', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
