-- Migration 576: Concierge Guest Profiles seed data
--
-- The Guest Profiles module (/erp/concierge/guest-profiles) reads real rows
-- from `guests` (preferences / identification_doc / special_requests JSONB +
-- text) and derives stay history from `reservations` and concierge history
-- from `guest_requests`. The demo guests had empty preferences and no past
-- stays, so the profile view rendered blank placeholders.
--
-- Preference keys follow the shared contract used by Front Office
-- (language, roomType, pillowType, bedType, dietary, newspaper, amenities,
-- emergencyContact, company) plus the concierge arrays (languages,
-- roomPreferences, dietaryPreferences, allergies, activities,
-- transportation, specialDates).

-- =============================================================
-- 1. Guest preferences + identity enrichment
-- =============================================================

UPDATE guests SET
  nationality = 'Ethiopian',
  special_requests = 'Prefers a suite on a high floor; private car for all transfers.',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('Amharic', 'English', 'French'),
    'roomType', 'Suite',
    'roomPreferences', jsonb_build_array('High floor', 'City view', 'Quiet room'),
    'pillowType', 'Firm',
    'bedType', 'King',
    'dietary', 'Halal',
    'dietaryPreferences', jsonb_build_array('Halal'),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('City tours', 'Fine dining', 'Golf'),
    'transportation', 'Private car',
    'specialDates', jsonb_build_array('Birthday — March 12', 'Anniversary — July 8'),
    'amenities', jsonb_build_array('Daily newspaper', 'Welcome amenity'),
    'newspaper', 'Financial Times'
  ),
  identification_doc = jsonb_build_object(
    'type', 'Passport',
    'number', 'EP1234567',
    'issuingCountry', 'Ethiopia',
    'expiryDate', '2029-05-20'
  )
WHERE id = 'GST-MOCK-002';

UPDATE guests SET
  nationality = 'Ethiopian',
  special_requests = 'Peanut allergy — please notify F&B before any amenity or dining arrangement.',
  preferences = jsonb_build_object(
    'language', 'Amharic',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Suite',
    'roomPreferences', jsonb_build_array('Spa access', 'Late checkout'),
    'pillowType', 'Soft',
    'bedType', 'King',
    'dietary', 'Vegetarian',
    'dietaryPreferences', jsonb_build_array('Vegetarian'),
    'allergies', jsonb_build_array('Peanuts'),
    'activities', jsonb_build_array('Spa & wellness', 'Shopping', 'Museums'),
    'transportation', 'Hotel shuttle',
    'specialDates', jsonb_build_array('Birthday — November 3'),
    'amenities', jsonb_build_array('Champagne on arrival')
  ),
  identification_doc = jsonb_build_object(
    'type', 'Passport',
    'number', 'EP7654321',
    'issuingCountry', 'Ethiopia',
    'expiryDate', '2028-11-14'
  )
WHERE id = 'GST-MOCK-005';

UPDATE guests SET
  nationality = 'Ethiopian',
  preferences = jsonb_build_object(
    'language', 'Amharic',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Double Room',
    'roomPreferences', jsonb_build_array('Quiet room'),
    'pillowType', 'Medium',
    'bedType', 'Queen',
    'dietary', 'None',
    'dietaryPreferences', jsonb_build_array(),
    'allergies', jsonb_build_array('Dust'),
    'activities', jsonb_build_array('Historical sites', 'Coffee ceremonies'),
    'transportation', 'Taxi',
    'specialDates', jsonb_build_array()
  )
WHERE id = 'GST-MOCK-001';

UPDATE guests SET
  nationality = 'Ethiopian',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Double Room',
    'dietary', 'Vegan',
    'dietaryPreferences', jsonb_build_array('Vegan'),
    'allergies', jsonb_build_array('Gluten'),
    'activities', jsonb_build_array('Hiking', 'Photography'),
    'transportation', 'Rental car',
    'specialDates', jsonb_build_array('Anniversary — September 30')
  )
WHERE id = 'GST-MOCK-003';

UPDATE guests SET
  nationality = 'Ethiopian',
  preferences = jsonb_build_object(
    'language', 'Amharic',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Single Room',
    'dietary', 'None',
    'dietaryPreferences', jsonb_build_array(),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('Business meetings'),
    'transportation', 'Taxi',
    'specialDates', jsonb_build_array()
  )
WHERE id = 'GST-MOCK-004';

UPDATE guests SET
  nationality = 'Ethiopian',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Double Room',
    'dietary', 'None',
    'dietaryPreferences', jsonb_build_array(),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('Nightlife', 'Live music'),
    'transportation', 'Taxi',
    'specialDates', jsonb_build_array()
  )
WHERE id = 'GST-MOCK-006';

UPDATE guests SET
  nationality = 'Ethiopian',
  preferences = jsonb_build_object(
    'language', 'Amharic',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Double Room',
    'roomPreferences', jsonb_build_array('Extra pillows', 'Bathtub'),
    'dietary', 'Vegetarian',
    'dietaryPreferences', jsonb_build_array('Vegetarian'),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('Spa & wellness', 'Local markets'),
    'transportation', 'Hotel shuttle',
    'specialDates', jsonb_build_array('Birthday — June 21')
  )
WHERE id = 'GST-MOCK-007';

UPDATE guests SET
  nationality = 'Ethiopian',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('Amharic', 'English'),
    'roomType', 'Double Room',
    'dietary', 'None',
    'dietaryPreferences', jsonb_build_array(),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('Photography tours'),
    'transportation', 'Taxi',
    'specialDates', jsonb_build_array()
  )
WHERE id = 'GST-MOCK-008';

UPDATE guests SET
  nationality = 'American',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('English'),
    'roomType', 'Double Room',
    'dietary', 'Gluten-Free',
    'dietaryPreferences', jsonb_build_array('Gluten-Free'),
    'allergies', jsonb_build_array('Gluten'),
    'activities', jsonb_build_array('Museums', 'City tours'),
    'transportation', 'Hotel shuttle',
    'specialDates', jsonb_build_array()
  )
WHERE id = 'GST-001';

UPDATE guests SET
  nationality = 'American',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('English'),
    'roomType', 'Single Room',
    'dietary', 'None',
    'dietaryPreferences', jsonb_build_array(),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('Business meetings'),
    'transportation', 'Taxi',
    'specialDates', jsonb_build_array()
  )
WHERE id = 'GST-002';

UPDATE guests SET
  nationality = 'British',
  special_requests = 'VIP — vegan menu required for all dining bookings.',
  preferences = jsonb_build_object(
    'language', 'English',
    'languages', jsonb_build_array('English', 'French'),
    'roomType', 'Suite',
    'dietary', 'Vegan',
    'dietaryPreferences', jsonb_build_array('Vegan'),
    'allergies', jsonb_build_array(),
    'activities', jsonb_build_array('Fine dining', 'Art galleries'),
    'transportation', 'Private car',
    'specialDates', jsonb_build_array('Birthday — April 2')
  )
WHERE id = 'GST-005';

-- =============================================================
-- 2. Past stays (CheckedOut) — gives profiles real stay history
-- =============================================================

INSERT INTO reservations (
  id, guest_id, guest_name, guest_email, guest_phone, guest_status,
  room_type, room_number, check_in_date, check_out_date,
  adults, children, status, rate, total_amount,
  channel, payment_status
) VALUES
('RES-HIST-01', 'GST-MOCK-002', 'Bereket Solomon', 'bereket.solomon@example.com', '+251 911 000 201', 'VIP',
 'Suite', '09', '2026-03-10', '2026-03-14', 2, 0, 'CheckedOut', 4500, 18000, 'Direct Website', 'Paid'),
('RES-HIST-02', 'GST-MOCK-002', 'Bereket Solomon', 'bereket.solomon@example.com', '+251 911 000 201', 'VIP',
 'Suite', '10', '2026-06-02', '2026-06-05', 2, 0, 'CheckedOut', 4500, 13500, 'Corporate', 'Paid'),
('RES-HIST-09', 'GST-MOCK-002', 'Bereket Solomon', 'bereket.solomon@example.com', '+251 911 000 201', 'VIP',
 'Suite', '09', '2025-11-15', '2025-11-19', 2, 0, 'CheckedOut', 4500, 18000, 'Direct Website', 'Paid'),
('RES-HIST-03', 'GST-MOCK-005', 'Liya Tesfaye', 'liya.tesfaye@example.com', '+251 911 000 205', 'VIP',
 'Suite', '10', '2026-05-18', '2026-05-21', 1, 0, 'CheckedOut', 4500, 13500, 'Direct Website', 'Paid'),
('RES-HIST-10', 'GST-MOCK-005', 'Liya Tesfaye', 'liya.tesfaye@example.com', '+251 911 000 205', 'VIP',
 'Suite', '09', '2026-01-22', '2026-01-25', 1, 0, 'CheckedOut', 4500, 13500, 'Booking.com', 'Paid'),
('RES-HIST-04', 'GST-MOCK-001', 'Aster Demissie', 'aster.demissie@example.com', '+251 911 000 206', 'Loyalty Member',
 'Double Room', '02', '2026-04-08', '2026-04-10', 1, 0, 'CheckedOut', 2500, 5000, 'Walk-In', 'Paid'),
('RES-HIST-05', 'GST-MOCK-007', 'Mekdes Araya', 'mekdes.araya@example.com', '+251 911 000 207', 'Loyalty Member',
 'Double Room', '12', '2026-07-01', '2026-07-04', 2, 1, 'CheckedOut', 2500, 7500, 'Booking.com', 'Paid'),
('RES-HIST-06', 'GST-MOCK-004', 'Dawit Hailu', 'dawit.hailu@example.com', '+251 911 000 208', 'Loyalty Member',
 'Single Room', '06', '2026-08-20', '2026-08-22', 1, 0, 'CheckedOut', 1800, 3600, 'Direct Website', 'Paid'),
('RES-HIST-07', 'GST-001', 'Sarah Johnson', 'sarah.johnson@example.com', '+1 555 0101', 'Regular',
 'Double Room', '01', '2026-02-11', '2026-02-14', 2, 0, 'CheckedOut', 2500, 7500, 'Expedia', 'Paid'),
('RES-HIST-08', 'GST-MOCK-008', 'Kalkidan Fikru', 'kalkidan.fikru@example.com', '+251 911 000 204', 'Regular',
 'Double Room', '14', '2026-06-25', '2026-06-28', 1, 0, 'CheckedOut', 2500, 7500, 'Booking.com', 'Paid')
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- 3. Past concierge requests (completed, with ratings)
-- =============================================================

INSERT INTO guest_requests (
  id, request_number, reservation_id, room_number, guest_name,
  request_type, description, priority, status,
  assigned_to, assigned_department,
  submitted_at, acknowledged_at, completed_at, rating, feedback
) VALUES
('REQ-HIST-01', 'REQ-HIST-0001', 'RES-HIST-01', '09', 'Bereket Solomon',
 'Transportation', 'Private car to Bole Airport — departure transfer.', 'High', 'Completed',
 'Mia Johnson', 'Concierge',
 '2026-03-14 06:00+00', '2026-03-14 06:10+00', '2026-03-14 07:30+00', 5, 'Driver was punctual and professional'),
('REQ-HIST-02', 'REQ-HIST-0002', 'RES-HIST-03', '10', 'Liya Tesfaye',
 'Restaurant Booking', 'Birthday dinner reservation with cake arrangement.', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge',
 '2026-05-19 12:00+00', '2026-05-19 12:30+00', '2026-05-19 15:00+00', 5, 'Lovely surprise setup'),
('REQ-HIST-03', 'REQ-HIST-0003', 'RES-HIST-04', '02', 'Aster Demissie',
 'Tour Booking', 'National Museum guided tour for one.', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge',
 '2026-04-09 09:00+00', '2026-04-09 09:20+00', '2026-04-09 11:00+00', 4, NULL),
('REQ-HIST-04', 'REQ-HIST-0004', 'RES-HIST-07', '01', 'Sarah Johnson',
 'Ticket Booking', 'Concert tickets at the national theatre.', 'Normal', 'Completed',
 'Mia Johnson', 'Concierge',
 '2026-02-12 14:00+00', '2026-02-12 14:30+00', '2026-02-12 17:00+00', 4, NULL)
ON CONFLICT (id) DO NOTHING;
