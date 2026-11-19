-- 450_guest_experience.sql
--
-- Guest experience: attendees, registrations, and seating arrangements.
-- Replaces the hardcoded mock data in the Guest Experience tab.

-- ── 1. Event guests / attendees ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_event_guests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text NOT NULL,
  guest_name text NOT NULL,
  email text,
  phone text,
  dietary_restrictions text,
  special_requirements text,
  rsvp_status text NOT NULL DEFAULT 'Pending',  -- Pending | Confirmed | Declined
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_guests_event ON public.banquet_event_guests (event_id);

-- ── 2. Event registrations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_event_registrations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text NOT NULL,
  attendee_name text NOT NULL,
  email text,
  phone text,
  organization text,
  registration_type text NOT NULL DEFAULT 'Standard',  -- Standard | VIP | EarlyBird | Student
  payment_status text NOT NULL DEFAULT 'Unpaid',      -- Unpaid | Paid | Refunded
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_registrations_event ON public.banquet_event_registrations (event_id);

-- ── 3. Seating arrangements ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banquet_event_seating (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  event_id text NOT NULL,
  table_name text NOT NULL,
  table_type text NOT NULL DEFAULT 'Round',  -- Round | Rectangular | U-Shape | Classroom | Theater | Cocktail
  capacity int NOT NULL DEFAULT 8,
  location text,
  assigned_to text,
  special_requests text,
  is_reserved boolean NOT NULL DEFAULT false,
  is_vip boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_seating_event ON public.banquet_event_seating (event_id);

-- ── 4. Seed mock data ────────────────────────────────────────────────
INSERT INTO public.banquet_event_guests (property_id, event_id, guest_name, email, phone, dietary_restrictions, special_requirements, rsvp_status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Dr. Abebe Kebede', 'abebe.kebede@techcorp.com', '+251911200345', 'Vegetarian', 'Keynote speaker — needs podium and lapel mic', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Hanan Ali', 'hanan.ali@techcorp.com', '+251911556789', 'None', 'Wheelchair access required', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Yonas Tesfaye', 'yonas.t@gmail.com', '+251912345678', 'Gluten-Free', '', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Sara Mohammed', 'sara.m@techcorp.com', '+251913567890', 'Halal', 'Prefers front-row seating', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Dawit Bekele', 'dawit.b@gmail.com', '+251914789012', 'None', '', 'Declined'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Selam Tadesse (Bride)', 'selam.t@gmail.com', '+251911100100', 'Vegetarian', 'Bride — bridal suite access', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Nahom Girma (Groom)', 'nahom.g@gmail.com', '+251911200200', 'None', 'Groom — groom room access', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Almaz Tadesse (Mother of Bride)', 'almaz.t@gmail.com', '+251911300300', 'Vegan', 'Family table near head table', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Girma Kebede (Father of Groom)', 'girma.k@gmail.com', '+251911400400', 'None', '', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Helen Alemu', 'helen.a@gmail.com', '+251911500500', 'Pescatarian', 'Photographer — needs access to all areas', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Robel Tesfaye', 'robel.t@gmail.com', '+251911600600', 'None', '', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Ambassador Kwame Mensah', 'k.mensah@au.int', '+250788123456', 'None', 'VIP — protocol team escort required', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Dr. Amina Hassan', 'a.hassan@au.int', '+250788654321', 'Halal', 'Translation headset — French', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Prof. Jean-Pierre Dubois', 'jp.dubois@au.int', '+250788987654', 'Vegetarian', 'Translation headset — English', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Eleni Gebremedhin', 'eleni.g@grandhotel.com', '+251911700700', 'Vegan', 'Sponsor representative — head table', 'Confirmed'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Tewodros Alemayehu', 'teddy.a@grandhotel.com', '+251911800800', 'None', '', 'Pending')
ON CONFLICT DO NOTHING;

INSERT INTO public.banquet_event_registrations (property_id, event_id, attendee_name, email, phone, organization, registration_type, payment_status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Dr. Abebe Kebede', 'abebe.kebede@techcorp.com', '+251911200345', 'TechCorp International', 'VIP', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Hanan Ali', 'hanan.ali@techcorp.com', '+251911556789', 'TechCorp International', 'Standard', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Yonas Tesfaye', 'yonas.t@gmail.com', '+251912345678', 'Independent', 'EarlyBird', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Sara Mohammed', 'sara.m@techcorp.com', '+251913567890', 'TechCorp International', 'Standard', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Dawit Bekele', 'dawit.b@gmail.com', '+251914789012', 'Independent', 'Student', 'Unpaid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Meron Girma', 'meron.g@techcorp.com', '+251915678901', 'TechCorp International', 'VIP', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Solomon Haile', 'solomon.h@gmail.com', '+251916789012', 'Independent', 'EarlyBird', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Tigist Alemu', 'tigist.a@startup.io', '+251917890123', 'StartupHub', 'Standard', 'Unpaid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Ambassador Kwame Mensah', 'k.mensah@au.int', '+250788123456', 'African Union', 'VIP', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Dr. Amina Hassan', 'a.hassan@au.int', '+250788654321', 'African Union', 'VIP', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Prof. Jean-Pierre Dubois', 'jp.dubois@au.int', '+250788987654', 'African Union', 'VIP', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Fatou Ndiaye', 'f.ndiaye@au.int', '+250789876543', 'African Union', 'Standard', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Eleni Gebremedhin', 'eleni.g@grandhotel.com', '+251911700700', 'Grand Hotel Group', 'VIP', 'Paid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Tewodros Alemayehu', 'teddy.a@grandhotel.com', '+251911800800', 'Grand Hotel Group', 'Standard', 'Unpaid'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Meseret Bekele', 'meseret.b@grandhotel.com', '+251911900900', 'Grand Hotel Group', 'EarlyBird', 'Paid')
ON CONFLICT DO NOTHING;

INSERT INTO public.banquet_event_seating (property_id, event_id, table_name, table_type, capacity, location, assigned_to, special_requests, is_reserved, is_vip) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Head Table', 'Rectangular', 12, 'Grand Ballroom — Stage Front', 'Bride, Groom, Parents', 'Floral centerpiece, champagne service', true, true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Table 1', 'Round', 10, 'Grand Ballroom — Left', 'Bride Family', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Table 2', 'Round', 10, 'Grand Ballroom — Left', 'Groom Family', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Table 3', 'Round', 8, 'Grand Ballroom — Right', 'College Friends', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Table 4', 'Round', 8, 'Grand Ballroom — Right', 'Colleagues', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Table 5', 'Round', 8, 'Grand Ballroom — Right', 'Family Friends', '', false, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Table 6', 'Round', 8, 'Grand Ballroom — Back', 'Photographer & DJ', 'Near power outlets', false, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Table A1', 'Round', 10, 'Crystal Ballroom A — Front', 'Keynote Speakers', 'Reserved for VIP speakers', true, true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Table A2', 'Round', 10, 'Crystal Ballroom A — Front', 'Sponsors', '', true, true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Table A3', 'Round', 8, 'Crystal Ballroom A — Center', 'TechCorp Executives', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Table A4', 'Round', 8, 'Crystal Ballroom A — Center', 'General Attendees', '', false, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Table A5', 'Round', 8, 'Crystal Ballroom A — Back', 'General Attendees', '', false, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Table B1', 'Rectangular', 12, 'Marble Conference A', 'Panel Discussion', 'Panel format — 6 panelists + moderator', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Table AU-1', 'U-Shape', 20, 'Terrace Lounge', 'AU Delegates — French', 'Translation headsets required', true, true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Table AU-2', 'U-Shape', 20, 'Azure Room', 'AU Delegates — English', 'Translation headsets required', true, true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Table AU-3', 'Round', 10, 'Terrace Lounge', 'Protocol Team', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Gala Table 1', 'Round', 10, 'Grand Ballroom — Stage', 'Sponsors & VIP', 'Head table — floral centerpiece', true, true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Gala Table 2', 'Round', 10, 'Grand Ballroom — Center', 'Donors', '', true, false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-003', 'Gala Table 3', 'Round', 8, 'Grand Ballroom — Right', 'General Guests', '', false, false)
ON CONFLICT DO NOTHING;
