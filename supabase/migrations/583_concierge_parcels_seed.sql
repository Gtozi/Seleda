-- Migration 583: Concierge parcel & package management seed
--
-- The Parcel Management module tracks incoming/outgoing packages through
-- guest_requests (request_type='Package'). One row existed from migration
-- 575; these add realistic received/pickup/delivery/courier requests across
-- all statuses, linked to the guests seeded in migration 575.

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-PKG-001', 'REQ-PKG-0001', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Package', 'Package Received · DHL envelope · hold for guest collection', 'Normal', 'In Progress',
 'Mia Johnson', 'Concierge', 'Signed by front desk — stored in secure cabinet, tag #P-204.',
 now() - interval '6 hours', now() - interval '5 hours', NULL, NULL, NULL),
('REQ-PKG-002', 'REQ-PKG-0002', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Package', 'Package Delivery · 2 boxes · deliver to room on arrival', 'High', 'Assigned',
 'Mia Johnson', 'Concierge', 'Business documents — handle with care, VIP.',
 now() - interval '3 hours', now() - interval '2 hours', NULL, NULL, NULL),
('REQ-PKG-003', 'REQ-PKG-0003', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Package', 'Package Pickup · collect from room · hand to courier at 15:00', 'Normal', 'Open',
 NULL, 'Concierge', 'FedEx pickup booked — airway bill in the envelope.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL),
('REQ-PKG-004', 'REQ-PKG-0004', 'RES-CONSC-D02', '07', 'Michael Williams',
 'Package', 'Outgoing Courier · ship documents to Nairobi office', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge', 'DHL Express booked — tracking #JD01460000123.',
 now() - interval '30 hours', now() - interval '28 hours', now() - interval '24 hours', 4,
 'Package sent on time, tracking shared promptly.'),
('REQ-PKG-005', 'REQ-PKG-0005', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Package', 'Package Received · large box · notify guest on arrival', 'Low', 'Open',
 NULL, 'Concierge', 'Oversized — stored in back office, shelf C.',
 now() - interval '4 hours', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
