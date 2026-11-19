-- Migration 584: Concierge VIP & butler services seed
--
-- The VIP Services module reads guest_requests (request_type='VIP Service')
-- plus VIP guests from the service-center overview. One VIP Service row
-- existed from migration 575; these add realistic amenity/arrival/butler
-- requests across all statuses, linked to seeded guests.

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-VIP-001', 'REQ-VIP-0001', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'VIP Service', 'Arrival Preparation · suite inspection + welcome fruit platter', 'High', 'Assigned',
 'Mia Johnson', 'Concierge', 'VIP arrival 14:00 — GM to greet at the door.',
 now() - interval '2 hours', now() - interval '90 minutes', NULL, NULL, NULL),
('REQ-VIP-002', 'REQ-VIP-0002', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'VIP Service', 'Welcome Amenity · champagne + macarons · deliver at 18:00', 'Normal', 'In Progress',
 'Mia Johnson', 'Concierge', 'Anniversary card signed by the GM.',
 now() - interval '4 hours', now() - interval '3 hours', NULL, NULL, NULL),
('REQ-VIP-003', 'REQ-VIP-0003', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'VIP Service', 'Butler Request · unpack luggage + press evening wear', 'Normal', 'Open',
 NULL, 'Concierge', 'Two suits for pressing — needed by 19:00.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL),
('REQ-VIP-004', 'REQ-VIP-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'VIP Service', 'Special Occasion · birthday cake to room · completed', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge', 'Surprise — deliver while guest at dinner.',
 now() - interval '30 hours', now() - interval '28 hours', now() - interval '26 hours', 5,
 'The cake was beautiful — thank you for the surprise!'),
('REQ-VIP-005', 'REQ-VIP-0005', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'VIP Service', 'Welcome Amenity · kids welcome pack + milk & cookies', 'Low', 'Open',
 NULL, 'Concierge', 'Family arrival — toddler-friendly snacks only.',
 now() - interval '3 hours', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
