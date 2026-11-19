-- =============================================================================
-- Migration 473: Spa & Wellness — Appointments + lookups
-- =============================================================================
-- First persistence layer for the Spa & Wellness portal. The
-- AppointmentManagementModule previously ran on hardcoded mock rows; this
-- migration creates the backing tables and seeds them with that same data.
--
-- Tables:
--   spa_treatments   — treatment catalog used by the booking form
--   spa_therapists   — therapist directory for assignment
--   spa_rooms        — treatment rooms / facilities
--   spa_appointments — the appointment book itself
--
-- Follows the guest_requests convention (migration 117): text PKs,
-- denormalized display names alongside FK references, nullable property_id.
-- RLS follows the banquet convention (456): authenticated CRUD + service role
-- bypass; property scoping is enforced at the API layer.
-- =============================================================================

-- ── Lookups ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_treatments (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  category         text NOT NULL,
  duration_minutes integer NOT NULL,
  price            numeric(12,2) NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  property_id      uuid REFERENCES public.properties(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.spa_therapists (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  title       text,
  specialties text[],
  phone       text,
  email       text,
  status      text NOT NULL DEFAULT 'Active',
  property_id uuid REFERENCES public.properties(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.spa_rooms (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  room_type   text NOT NULL,
  capacity    integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'Available',
  property_id uuid REFERENCES public.properties(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Appointments ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_appointments (
  id               text PRIMARY KEY,
  guest_id         text,
  guest_name       text NOT NULL,
  treatment_id     text REFERENCES public.spa_treatments(id) ON DELETE SET NULL,
  treatment        text NOT NULL,
  therapist_id     text REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  therapist        text,
  room_id          text REFERENCES public.spa_rooms(id) ON DELETE SET NULL,
  room             text,
  appointment_date date NOT NULL,
  start_time       text NOT NULL,
  duration_minutes integer NOT NULL,
  status           text NOT NULL DEFAULT 'Requested',
  source           text NOT NULL DEFAULT 'Reception',
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  notes            text,
  property_id      uuid REFERENCES public.properties(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spa_appointments_date    ON public.spa_appointments (appointment_date);
CREATE INDEX IF NOT EXISTS idx_spa_appointments_status  ON public.spa_appointments (status);
CREATE INDEX IF NOT EXISTS idx_spa_appointments_guest   ON public.spa_appointments (guest_id);
CREATE INDEX IF NOT EXISTS idx_spa_appointments_therapist ON public.spa_appointments (therapist_id, appointment_date);

COMMENT ON TABLE public.spa_appointments IS
  'Spa & Wellness appointment book. Status lifecycle: Requested → Confirmed → '
  'Checked In → In Treatment → Completed, or Cancelled / No Show / Rescheduled.';

-- ── RLS (banquet convention: authenticated CRUD, service role bypasses) ──────

ALTER TABLE public.spa_treatments ENABLE ROW LEVEL SECURITY;
CREATE POLICY spa_treatments_authenticated ON public.spa_treatments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_treatments TO authenticated;

ALTER TABLE public.spa_therapists ENABLE ROW LEVEL SECURITY;
CREATE POLICY spa_therapists_authenticated ON public.spa_therapists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_therapists TO authenticated;

ALTER TABLE public.spa_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY spa_rooms_authenticated ON public.spa_rooms
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_rooms TO authenticated;

ALTER TABLE public.spa_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY spa_appointments_authenticated ON public.spa_appointments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_appointments TO authenticated;

-- ── Seed: treatment catalog ──────────────────────────────────────────────────

INSERT INTO public.spa_treatments (id, name, category, duration_minutes, price) VALUES
  ('TRT-001', 'Swedish Massage',          'Massage',           60, 120),
  ('TRT-002', 'Deep Tissue Massage',      'Massage',           90, 150),
  ('TRT-003', 'Hot Stone Massage',        'Massage',           75, 165),
  ('TRT-004', 'Aromatherapy Massage',     'Massage',           60, 130),
  ('TRT-005', 'Thai Massage',             'Massage',           90, 155),
  ('TRT-006', 'Hydrating Facial',         'Facial Treatments', 45,  95),
  ('TRT-007', 'Anti-Aging Facial',        'Facial Treatments', 60, 140),
  ('TRT-008', 'Brightening Facial',       'Facial Treatments', 50, 110),
  ('TRT-009', 'Body Scrub',               'Body Treatments',   45,  85),
  ('TRT-010', 'Body Wrap',                'Body Treatments',   60, 120),
  ('TRT-011', 'Detox Therapy',            'Body Treatments',   75, 150),
  ('TRT-012', 'Manicure',                 'Beauty Services',   45,  45),
  ('TRT-013', 'Pedicure',                 'Beauty Services',   60,  55),
  ('TRT-014', 'Haircut & Styling',        'Beauty Services',   60,  70),
  ('TRT-015', 'Yoga Session',             'Wellness',          60,  40),
  ('TRT-016', 'Meditation Session',       'Wellness',          45,  35),
  ('TRT-017', 'Nutrition Consultation',   'Wellness',          60,  90),
  ('TRT-018', 'Couples Retreat Package',  'Wellness Packages', 120, 350)
ON CONFLICT (id) DO NOTHING;

-- ── Seed: therapists ─────────────────────────────────────────────────────────

INSERT INTO public.spa_therapists (id, name, title, specialties) VALUES
  ('THP-001', 'Emily Chen',    'Massage Therapist', ARRAY['Swedish', 'Hot Stone', 'Aromatherapy']),
  ('THP-002', 'David Miller',  'Massage Therapist', ARRAY['Deep Tissue', 'Sports Massage', 'Thai Massage']),
  ('THP-003', 'Lisa Park',     'Esthetician',       ARRAY['Facials', 'Skincare', 'Anti-Aging']),
  ('THP-004', 'Anna Rodriguez','Beauty Therapist',  ARRAY['Manicure', 'Pedicure', 'Makeup']),
  ('THP-005', 'Tom Baker',     'Yoga Instructor',   ARRAY['Yoga', 'Meditation', 'Breathing'])
ON CONFLICT (id) DO NOTHING;

-- ── Seed: rooms ──────────────────────────────────────────────────────────────

INSERT INTO public.spa_rooms (id, name, room_type, capacity) VALUES
  ('SRM-001', 'Massage Room 1',    'Massage Room',       1),
  ('SRM-002', 'Massage Room 2',    'Massage Room',       1),
  ('SRM-003', 'Facial Room 1',     'Facial Room',        1),
  ('SRM-004', 'Couples Room',      'Couples Room',       2),
  ('SRM-005', 'Hydrotherapy Room', 'Hydrotherapy Room',  1),
  ('SRM-006', 'Salon Station 1',   'Salon Station',      1),
  ('SRM-007', 'Yoga Studio',       'Yoga Studio',       12)
ON CONFLICT (id) DO NOTHING;

-- ── Seed: guests referenced by the mock appointments ─────────────────────────

INSERT INTO public.guests (id, name, email, phone, status) VALUES
  ('GST-001', 'Sarah Johnson',   'sarah.johnson@example.com',   '+1-555-0101', 'Regular'),
  ('GST-002', 'Michael Williams','michael.williams@example.com','+1-555-0102', 'Regular'),
  ('GST-003', 'Emma Davis',      'emma.davis@example.com',      '+1-555-0103', 'Regular'),
  ('GST-004', 'James Brown',     'james.brown@example.com',     '+1-555-0104', 'Regular'),
  ('GST-005', 'Olivia Wilson',   'olivia.wilson@example.com',   '+1-555-0105', 'VIP')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: the mock appointments (previously hardcoded in the module) ─────────

INSERT INTO public.spa_appointments
  (id, guest_id, guest_name, treatment_id, treatment, therapist_id, therapist,
   room_id, room, appointment_date, start_time, duration_minutes, status, source, amount, notes)
VALUES
  ('APT-001', 'GST-001', 'Sarah Johnson',   'TRT-001', 'Swedish Massage',       'THP-001', 'Emily Chen',   'SRM-001', 'Massage Room 1', '2026-07-31', '09:00', 60,  'In Treatment', 'Guest Portal', 120, 'Prefers light pressure'),
  ('APT-002', 'GST-002', 'Michael Williams','TRT-002', 'Deep Tissue Massage',   'THP-002', 'David Miller', 'SRM-002', 'Massage Room 2', '2026-07-31', '10:30', 90,  'Confirmed',    'Concierge',    150, 'Focus on lower back'),
  ('APT-003', 'GST-003', 'Emma Davis',      'TRT-006', 'Hydrating Facial',      'THP-003', 'Lisa Park',    'SRM-003', 'Facial Room 1',  '2026-07-31', '11:00', 45,  'Checked In',   'Front Desk',    95, 'Sensitive skin'),
  ('APT-004', 'GST-004', 'James Brown',     'TRT-003', 'Hot Stone Massage',     'THP-001', 'Emily Chen',   'SRM-001', 'Massage Room 1', '2026-07-31', '14:00', 75,  'Confirmed',    'Telephone',    165, NULL),
  ('APT-005', 'GST-005', 'Olivia Wilson',   'TRT-018', 'Couples Retreat Package','THP-002','David Miller & Emily Chen','SRM-004','Couples Room','2026-07-31','15:30',120,'Confirmed','Guest Portal',350,'Anniversary celebration')
ON CONFLICT (id) DO NOTHING;
