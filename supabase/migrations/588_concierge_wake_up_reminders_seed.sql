-- Migration 588: Concierge wake-up & reminder services seed
--
-- The Wake-up & Reminder module tracks scheduled calls and activity
-- reminders in guest_requests (request_type='Wake-up Call'). One request
-- existed from migration 575; these add a realistic reminder board.

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department, notes,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-WAKE-001', 'REQ-WAKE-0001', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Wake-up Call', 'Wake-up Call · tomorrow 05:30', 'High', 'Assigned',
 'Night Desk', 'Concierge', 'VIP — early departure, flight ET302 at 08:00. Confirm night before.',
 now() - interval '5 hours', now() - interval '4 hours', NULL, NULL, NULL),
('REQ-WAKE-002', 'REQ-WAKE-0002', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Wake-up Call', 'Wake-up Call · Saturday 06:30', 'Normal', 'Open',
 NULL, 'Concierge', 'Before the Addis Highlights Day itinerary — pickup at 08:00.',
 now() - interval '3 hours', NULL, NULL, NULL, NULL),
('REQ-WAKE-003', 'REQ-WAKE-0003', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Wake-up Call', 'Activity Reminder · Entoto Adventure Day · Sunday 07:00', 'Low', 'Open',
 NULL, 'Concierge', 'Family tour — remind kids to bring jackets.',
 now() - interval '1 hour', NULL, NULL, NULL, NULL),
('REQ-WAKE-004', 'REQ-WAKE-0004', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Wake-up Call', 'Wake-up Call · completed · 06:00', 'Normal', 'Completed',
 'Night Desk', 'Concierge', NULL,
 now() - interval '30 hours', now() - interval '29 hours', now() - interval '24 hours', NULL, NULL),
('REQ-WAKE-005', 'REQ-WAKE-0005', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Wake-up Call', 'Departure Reminder · checkout Monday 10:00 · bags to lobby 09:30', 'Normal', 'Assigned',
 'Night Desk', 'Concierge', 'Late checkout approved until 10:00.',
 now() - interval '6 hours', now() - interval '5 hours', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
