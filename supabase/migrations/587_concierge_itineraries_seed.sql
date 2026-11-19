-- Migration 587: Concierge itinerary planner seed
--
-- The Itinerary Planner module offers curated day-plan templates from
-- `guest_services` (category='itinerary') and tracks planning requests in
-- guest_requests (request_type='Itinerary Planning').

ALTER TABLE guest_services DROP CONSTRAINT IF EXISTS guest_services_category_check;
ALTER TABLE guest_services ADD CONSTRAINT guest_services_category_check
  CHECK (category = ANY (ARRAY['dining','transportation','laundry','spa','room_service','concierge','tour','ticketing','shopping','itinerary']));

-- ── Itinerary templates catalog ───────────────────────────────────────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
('gs_itin_01', 'Addis Highlights Day', 'National Museum, Holy Trinity Cathedral, Merkato, and a traditional coffee ceremony — the essential Addis in one day. ~8 hours.', 'itinerary', 95.00, true),
('gs_itin_02', 'Heritage & Museums Day', 'Ethnological Museum, Red Terror Memorial, St. George Cathedral, and Piazza district walk. ~6 hours.', 'itinerary', 65.00, true),
('gs_itin_03', 'Coffee Culture Day', 'Tomoca Coffee tasting, coffee farm visit, roasting workshop, and ceremony at a local home. ~5 hours.', 'itinerary', 55.00, true),
('gs_itin_04', 'Shopping & Souvenirs Day', 'Shiromeda market, Sabahar weaving, Merkato spice quarter, and gold souk with concierge escort. ~6 hours.', 'itinerary', 40.00, true),
('gs_itin_05', 'Entoto Adventure Day', 'Entoto Natural Park hike, panoramic viewpoints, zip-line, and picnic lunch in the eucalyptus forest. ~7 hours.', 'itinerary', 70.00, true),
('gs_itin_06', 'Evening Cultural Experience', 'Sunset at Entoto viewpoint, Yod Abyssinia cultural dinner, and Fendika azmari music night. ~5 hours.', 'itinerary', 60.00, true),
('gs_itin_07', 'Custom Multi-Day Itinerary', 'Fully bespoke multi-day plan — Lalibela, Simien, or Danakil extensions with dedicated travel coordinator.', 'itinerary', 250.00, false)
ON CONFLICT (id) DO NOTHING;

-- ── Itinerary planning requests linked to seeded guests ───────────────────
INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-ITIN-001', 'REQ-ITIN-0001', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Itinerary Planning', 'Addis Highlights Day · Saturday · 2 participants', 'Normal', 'Assigned',
 'Mia Johnson', 'Concierge', 'Anniversary trip — include a photo stop at Entoto viewpoint.',
 now() - interval '4 hours', now() - interval '3 hours', NULL, NULL, NULL),
('REQ-ITIN-002', 'REQ-ITIN-0002', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Itinerary Planning', 'Shopping & Souvenirs Day · tomorrow · 1 participant', 'Normal', 'Open',
 NULL, 'Concierge', 'Prefers morning start, skip the gold souk.',
 now() - interval '2 hours', NULL, NULL, NULL, NULL),
('REQ-ITIN-003', 'REQ-ITIN-0003', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Itinerary Planning', 'Custom Multi-Day Itinerary · Lalibela weekend extension', 'High', 'In Progress',
 'Mia Johnson', 'Concierge', 'VIP — charter flight preferred, confirm Friday departure.',
 now() - interval '8 hours', now() - interval '6 hours', NULL, NULL, NULL),
('REQ-ITIN-004', 'REQ-ITIN-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Itinerary Planning', 'Coffee Culture Day · completed · 1 participant', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge', NULL,
 now() - interval '72 hours', now() - interval '70 hours', now() - interval '60 hours', 5,
 'The farm visit was the highlight of my trip — flawless planning.'),
('REQ-ITIN-005', 'REQ-ITIN-0005', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Itinerary Planning', 'Entoto Adventure Day · Sunday · 4 participants (2 kids)', 'Low', 'Open',
 NULL, 'Concierge', 'Kids aged 7 and 10 — check zip-line age limits.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
