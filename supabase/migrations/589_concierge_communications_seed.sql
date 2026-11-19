-- Migration 589: Concierge guest communications seed
--
-- The Guest Communication Center reads `guest_communications`. The table
-- was empty; these seed a realistic inbox across all allowed message_type
-- and status values (Request/Booking/Inquiry/Complaint/Other ×
-- Pending/In Progress/Resolved), linked to seeded guests/reservations.

-- Self-contained: the table was previously created outside migrations.
-- Kept in sync with 595_concierge_portal_gap_fixes.sql.
CREATE TABLE IF NOT EXISTS public.guest_communications (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  guest_id       text,
  reservation_id text,
  room_number    text,
  message        text NOT NULL,
  message_type   text NOT NULL DEFAULT 'Inquiry'
                 CHECK (message_type IN ('Request','Booking','Inquiry','Complaint','Other')),
  status         text NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending','In Progress','Resolved')),
  reply          text,
  replied_by     text,
  replied_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO guest_communications (
  id, guest_id, reservation_id, room_number,
  message, message_type, status,
  reply, replied_by, replied_at, created_at
) VALUES
('gc_001', 'GST-MOCK-002', 'RES-CONSC-A01', '09',
 'Could you arrange a late checkout for Friday? My flight is not until 20:00.',
 'Request', 'Pending', NULL, NULL, NULL, now() - interval '2 hours'),
('gc_002', 'GST-MOCK-005', 'RES-CONSC-I01', '10',
 'We would love to book the anniversary dinner you recommended — Saturday at 19:00 if possible.',
 'Booking', 'In Progress', 'Confirming with La Maison — will send the booking reference within the hour.',
 'Mia Johnson', now() - interval '45 minutes', now() - interval '4 hours'),
('gc_003', 'GST-MOCK-001', 'RES-CONSC-I02', '02',
 'What time does the museum open tomorrow? And is a guide available in French?',
 'Inquiry', 'Resolved', 'The National Museum opens at 08:30. A French-speaking guide is available — arranged for 09:00 pickup.',
 'Mia Johnson', now() - interval '5 hours', now() - interval '7 hours'),
('gc_004', 'GST-MOCK-007', 'RES-CONSC-I03', '12',
 'The room next door was quite loud last night — could we move to a quieter floor?',
 'Complaint', 'In Progress', 'So sorry about that — checking availability on the executive floor now.',
 'Mia Johnson', now() - interval '30 minutes', now() - interval '8 hours'),
('gc_005', 'GST-MOCK-004', 'RES-CONSC-D01', '06',
 'Thank you for the wonderful coffee ceremony yesterday — can we book it again before we leave?',
 'Other', 'Resolved', 'Absolutely — reserved for tomorrow at 15:00 in the lobby lounge.',
 'Mia Johnson', now() - interval '20 hours', now() - interval '26 hours'),
('gc_006', 'GST-MOCK-003', 'RES-CONSC-A02', '04',
 'Do you have a crib available? We arrive Thursday with our 18-month-old.',
 'Request', 'Resolved', 'A crib will be in your room on arrival — see you Thursday.',
 'Mia Johnson', now() - interval '2 days', now() - interval '3 days'),
('gc_007', 'GST-MOCK-006', 'RES-CONSC-A03', '11',
 'Is the hotel gym open early? I would like to work out before my meetings.',
 'Inquiry', 'Pending', NULL, NULL, NULL, now() - interval '1 hour'),
('gc_008', 'GST-MOCK-002', 'RES-CONSC-A01', '09',
 'Please add a second VIP transport to my booking — colleague arriving Saturday on ET501.',
 'Booking', 'Pending', NULL, NULL, NULL, now() - interval '30 minutes')
ON CONFLICT (id) DO NOTHING;
