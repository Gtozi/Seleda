-- Migration 575: Concierge Guest Service Center seed data
--
-- The Guest Service Center module (/erp/concierge/service-center) reads
-- real rows from `reservations` (in-house / arriving / departing) and
-- `guest_requests` (the concierge service queue). The table was previously
-- empty so the module rendered blank placeholders.
--
-- This seeds demo data against the existing GST-MOCK-* guest records:
--   - 4 reservations arriving today (Confirmed)
--   - 4 reservations in-house (CheckedIn, multi-day stays spanning today)
--   - 2 reservations departing today (CheckedIn, check_out = today)
--   - 13 guest_requests assigned to the Concierge department
-- Room statuses are synced so the Front Office room board stays consistent.

-- =============================================================
-- 1. Reservations
-- =============================================================

INSERT INTO reservations (
  id, guest_id, guest_name, guest_email, guest_phone, guest_status,
  room_type, room_number, check_in_date, check_out_date,
  adults, children, status, rate, total_amount,
  channel, payment_status
) VALUES
-- ── Arriving today ────────────────────────────────────────────
('RES-CONSC-A01', 'GST-MOCK-002', 'Bereket Solomon', 'bereket.solomon@example.com', '+251 911 000 201', 'VIP',
 'Suite', '09', CURRENT_DATE, CURRENT_DATE + 3,
 2, 0, 'Confirmed', 4500, 13500, 'Direct Website', 'Paid'),
('RES-CONSC-A02', 'GST-MOCK-003', 'Hiwot Girma', 'hiwot.girma@example.com', '+251 911 000 202', 'Regular',
 'Double Room', '04', CURRENT_DATE, CURRENT_DATE + 2,
 2, 0, 'Confirmed', 2500, 5000, 'Booking.com', 'Paid'),
('RES-CONSC-A03', 'GST-MOCK-006', 'Yared Tadesse', 'yared.tadesse@example.com', '+251 911 000 203', 'Regular',
 'Double Room', '11', CURRENT_DATE, CURRENT_DATE + 1,
 1, 0, 'Confirmed', 2500, 2500, 'Walk-In', 'Unpaid'),
('RES-CONSC-A04', 'GST-MOCK-008', 'Kalkidan Fikru', 'kalkidan.fikru@example.com', '+251 911 000 204', 'Regular',
 'Double Room', '14', CURRENT_DATE, CURRENT_DATE + 4,
 1, 1, 'Confirmed', 2500, 10000, 'Expedia', 'Paid'),
-- ── In-house (checked in earlier this week) ──────────────────
('RES-CONSC-I01', 'GST-MOCK-005', 'Liya Tesfaye', 'liya.tesfaye@example.com', '+251 911 000 205', 'VIP',
 'Suite', '10', CURRENT_DATE - 2, CURRENT_DATE + 2,
 2, 0, 'CheckedIn', 4500, 18000, 'Corporate', 'Paid'),
('RES-CONSC-I02', 'GST-MOCK-001', 'Aster Demissie', 'aster.demissie@example.com', '+251 911 000 206', 'Loyalty Member',
 'Double Room', '02', CURRENT_DATE - 2, CURRENT_DATE + 1,
 1, 0, 'CheckedIn', 2500, 7500, 'Direct Website', 'Paid'),
('RES-CONSC-I03', 'GST-MOCK-007', 'Mekdes Araya', 'mekdes.araya@example.com', '+251 911 000 207', 'Loyalty Member',
 'Double Room', '12', CURRENT_DATE - 1, CURRENT_DATE + 3,
 2, 1, 'CheckedIn', 2500, 10000, 'Booking.com', 'Partial'),
('RES-CONSC-I04', 'GST-001', 'Sarah Johnson', 'sarah.johnson@example.com', '+1 555 0101', 'Regular',
 'Double Room', '01', CURRENT_DATE - 3, CURRENT_DATE + 4,
 2, 0, 'CheckedIn', 2500, 17500, 'Walk-In', 'Paid'),
-- ── Departing today ───────────────────────────────────────────
('RES-CONSC-D01', 'GST-MOCK-004', 'Dawit Hailu', 'dawit.hailu@example.com', '+251 911 000 208', 'Loyalty Member',
 'Single Room', '06', CURRENT_DATE - 2, CURRENT_DATE,
 1, 0, 'CheckedIn', 1800, 3600, 'Direct Website', 'Paid'),
('RES-CONSC-D02', 'GST-002', 'Michael Williams', 'michael.williams@example.com', '+1 555 0102', 'Regular',
 'Single Room', '07', CURRENT_DATE - 1, CURRENT_DATE,
 1, 0, 'CheckedIn', 1800, 1800, 'Expedia', 'Paid')
ON CONFLICT (id) DO NOTHING;

-- Keep the room board consistent with seeded occupancy.
UPDATE rooms SET status = 'Occupied Clean' WHERE number IN ('01', '02', '10', '12');
UPDATE rooms SET status = 'Occupied Dirty' WHERE number IN ('06', '07');

-- =============================================================
-- 2. Guest requests (concierge service queue)
-- =============================================================

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-CONSC-001', 'REQ-CONSC-0001', 'RES-CONSC-A01', '09', 'Bereket Solomon',
 'Transportation', 'Airport pickup — flight ET302 arriving 06:30 tomorrow.', 'High', 'Assigned',
 'Mia Johnson', 'Concierge',
 now() - interval '3 hours', now() - interval '2 hours', NULL, NULL, NULL),
('REQ-CONSC-002', 'REQ-CONSC-0002', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'Restaurant Booking', 'Dinner for 2 at the rooftop restaurant tonight at 19:30.', 'Normal', 'Open',
 NULL, 'Concierge',
 now() - interval '45 minutes', NULL, NULL, NULL, NULL),
('REQ-CONSC-003', 'REQ-CONSC-0003', 'RES-CONSC-I01', '10', 'Liya Tesfaye',
 'VIP Service', 'Champagne amenity setup in the suite before 18:00.', 'High', 'In Progress',
 'Mia Johnson', 'Concierge',
 now() - interval '5 hours', now() - interval '4 hours', NULL, NULL, NULL),
('REQ-CONSC-004', 'REQ-CONSC-0004', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Tour Booking', 'Half-day city tour for 2 guests — pickup tomorrow 08:00.', 'Normal', 'Assigned',
 'Mia Johnson', 'Concierge',
 now() - interval '8 hours', now() - interval '7 hours', NULL, NULL, NULL),
('REQ-CONSC-005', 'REQ-CONSC-0005', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Wake-up Call', 'Daily wake-up call at 06:00 for the remainder of the stay.', 'Low', 'Open',
 NULL, 'Concierge',
 now() - interval '26 hours', NULL, NULL, NULL, NULL),
('REQ-CONSC-006', 'REQ-CONSC-0006', 'RES-CONSC-I03', '12', 'Mekdes Araya',
 'Luggage', 'Store 3 suitcases at the bell desk until departure.', 'Normal', 'Open',
 NULL, 'Concierge',
 now() - interval '2 hours', NULL, NULL, NULL, NULL),
('REQ-CONSC-007', 'REQ-CONSC-0007', 'RES-CONSC-I04', '01', 'Sarah Johnson',
 'Ticket Booking', 'Two tickets to the National Museum for Saturday.', 'Normal', 'In Progress',
 'Mia Johnson', 'Concierge',
 now() - interval '30 hours', now() - interval '28 hours', NULL, NULL, NULL),
('REQ-CONSC-008', 'REQ-CONSC-0008', 'RES-CONSC-D01', '06', 'Dawit Hailu',
 'Transportation', 'Taxi to Bole Airport at 11:00 today — flight ET815.', 'Urgent', 'Open',
 NULL, 'Concierge',
 now() - interval '1 hour', NULL, NULL, NULL, NULL),
('REQ-CONSC-009', 'REQ-CONSC-0009', 'RES-CONSC-D02', '07', 'Michael Williams',
 'Package', 'Collect parcel from reception before checkout.', 'Normal', 'Open',
 NULL, 'Concierge',
 now() - interval '4 hours', NULL, NULL, NULL, NULL),
('REQ-CONSC-010', 'REQ-CONSC-0010', 'RES-CONSC-A02', '04', 'Hiwot Girma',
 'Restaurant Booking', 'Vegetarian dinner for 2 on arrival evening.', 'Normal', 'Open',
 NULL, 'Concierge',
 now() - interval '6 hours', NULL, NULL, NULL, NULL),
('REQ-CONSC-011', 'REQ-CONSC-0011', 'RES-CONSC-A03', '11', 'Yared Tadesse',
 'General Inquiry', 'Requests early check-in — arriving around 09:00.', 'High', 'Open',
 NULL, 'Concierge',
 now() - interval '10 hours', NULL, NULL, NULL, NULL),
('REQ-CONSC-012', 'REQ-CONSC-0012', 'RES-CONSC-A04', '14', 'Kalkidan Fikru',
 'Personal Shopping', 'Souvenir shopping assistance this weekend.', 'Low', 'Assigned',
 'Mia Johnson', 'Concierge',
 now() - interval '12 hours', now() - interval '11 hours', NULL, NULL, NULL),
-- One completed request for history / satisfaction metrics
('REQ-CONSC-013', 'REQ-CONSC-0013', 'RES-CONSC-I02', '02', 'Aster Demissie',
 'Luggage', 'Extra blanket and pillows delivered to the room.', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge',
 now() - interval '30 hours', now() - interval '29 hours', now() - interval '28 hours', 5, 'Very quick service')
ON CONFLICT (id) DO NOTHING;
