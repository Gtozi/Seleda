-- Migration 585: Concierge personal shopping seed
--
-- The Personal Shopping module reads shopping venues/services from
-- `guest_services` (category='shopping') and shopping requests from
-- guest_requests (request_type='Personal Shopping'). One request existed
-- from migration 575; these seed the venue catalog and linked requests.

ALTER TABLE guest_services DROP CONSTRAINT IF EXISTS guest_services_category_check;
ALTER TABLE guest_services ADD CONSTRAINT guest_services_category_check
  CHECK (category = ANY (ARRAY['dining','transportation','laundry','spa','room_service','concierge','tour','ticketing','shopping']));

-- ── Shopping destinations catalog ─────────────────────────────────────────
INSERT INTO guest_services (id, name, description, category, price, available) VALUES
('gs_shop_01', 'Merkato Shopping Escort', 'Guided escort through Merkato — spices, textiles, traditional crafts, and bulk coffee. Bargaining help included. ~3 hours.', 'shopping', 25.00, true),
('gs_shop_02', 'Shiromeda Traditional Clothing', 'Assisted shopping for traditional habesha kemis and handwoven cotton clothing at Shiromeda market.', 'shopping', 20.00, true),
('gs_shop_03', 'Friendship Mall & Boutiques', 'Modern mall experience — international brands, electronics, and fashion at Friendship Center.', 'shopping', 15.00, true),
('gs_shop_04', 'Gold & Jewelry Souk Visit', 'Escorted visit to the gold souk near Piazza — 18k gold jewelry, trusted vendors, authentication help.', 'shopping', 30.00, true),
('gs_shop_05', 'Coffee & Souvenir Sourcing', 'Curated coffee beans (Yirgacheffe, Sidamo, Harrar) plus packaged souvenirs and gifts for home.', 'shopping', 20.00, true),
('gs_shop_06', 'Custom Tailoring Service', 'Arrange bespoke traditional garment tailoring with measurements taken at the hotel.', 'shopping', 40.00, false)
ON CONFLICT (id) DO NOTHING;

-- ── Personal shopping requests linked to seeded guests ────────────────────
INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-SHOP-001', 'REQ-SHOP-0001', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Personal Shopping', 'Gold & Jewelry Souk Visit · Saturday morning · 2 guests', 'Normal', 'Assigned',
 'Mia Johnson', 'Concierge', 'Looking for a traditional gold necklace — budget ~$800.',
 now() - interval '3 hours', now() - interval '2 hours', NULL, NULL, NULL),
('REQ-SHOP-002', 'REQ-SHOP-0002', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Personal Shopping', 'Shiromeda Traditional Clothing · tomorrow · habesha kemis for 2', 'Normal', 'Open',
 NULL, 'Concierge', 'Sizes needed — measure at the desk first.',
 now() - interval '2 hours', NULL, NULL, NULL, NULL),
('REQ-SHOP-003', 'REQ-SHOP-0003', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Personal Shopping', 'Coffee & Souvenir Sourcing · bulk Yirgacheffe for office gifts', 'High', 'In Progress',
 'Mia Johnson', 'Concierge', 'VIP — wants 20 x 1kg bags, vacuum sealed.',
 now() - interval '6 hours', now() - interval '5 hours', NULL, NULL, NULL),
('REQ-SHOP-004', 'REQ-SHOP-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Personal Shopping', 'Merkato Shopping Escort · completed · half-day spice run', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge', NULL,
 now() - interval '48 hours', now() - interval '46 hours', now() - interval '40 hours', 5,
 'Fantastic guide — saved a fortune on saffron and berbere.'),
('REQ-SHOP-005', 'REQ-SHOP-0005', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Personal Shopping', 'Friendship Mall & Boutiques · this afternoon · kids clothing', 'Low', 'Open',
 NULL, 'Concierge', 'Needs stroller-friendly route through the mall.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
