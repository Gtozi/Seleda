-- Migration 582: Concierge luggage services seed
--
-- The Luggage Services module is the bell-desk queue — it reads/writes
-- guest_requests with request_type='Luggage'. Two rows existed from
-- migration 575; these add realistic storage/delivery/pickup requests
-- across all statuses, linked to the guests seeded in migration 575.

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-LUG-001', 'REQ-LUG-0001', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Luggage', 'Baggage Delivery · 4 bags · bring up on arrival', 'High', 'Assigned',
 'Mia Johnson', 'Concierge', 'VIP arrival — priority delivery, garment bag on top.',
 now() - interval '90 minutes', now() - interval '1 hour', NULL, NULL, NULL),
('REQ-LUG-002', 'REQ-LUG-0002', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Luggage', 'Luggage Storage · 2 suitcases · until 18:00 checkout day', 'Normal', 'In Progress',
 'Mia Johnson', 'Concierge', 'Stored in locker B4 — tag #L-118.',
 now() - interval '5 hours', now() - interval '4 hours', NULL, NULL, NULL),
('REQ-LUG-003', 'REQ-LUG-0003', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Luggage', 'Porter Assistance · stroller + 2 bags · lobby to room', 'Normal', 'Open',
 NULL, 'Concierge', 'Family with toddler — needs help at the lift.',
 now() - interval '30 minutes', NULL, NULL, NULL, NULL),
('REQ-LUG-004', 'REQ-LUG-0004', 'RES-CONSC-D02', '07', 'Michael Williams',
 'Luggage', 'Luggage Pickup · 3 bags · collect from room at 10:30', 'High', 'Completed',
 'Mia Johnson', 'Concierge', 'Departure — deliver to waiting taxi.',
 now() - interval '7 hours', now() - interval '6 hours', now() - interval '5 hours', 5,
 'Bellman was waiting before we even called.'),
('REQ-LUG-005', 'REQ-LUG-0005', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Luggage', 'Luggage Storage · 1 garment bag · overnight until early checkout', 'Low', 'Open',
 NULL, 'Concierge', 'Fragile — hang, do not fold.',
 now() - interval '2 hours', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
