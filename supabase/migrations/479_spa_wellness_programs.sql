-- ─── Spa wellness programs + enrollments ─────────────────────────────────────
-- Structured multi-day wellness programs. Enrollment counts are derived live
-- from spa_program_enrollments rather than stored.

CREATE TABLE IF NOT EXISTS public.spa_wellness_programs (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  program_type      text NOT NULL,
  description       text,
  duration_days     integer NOT NULL DEFAULT 1,
  sessions          integer NOT NULL DEFAULT 1,
  price             numeric NOT NULL DEFAULT 0,
  capacity          integer NOT NULL DEFAULT 10,
  status            text NOT NULL DEFAULT 'Upcoming'
                    CHECK (status IN ('Active','Upcoming','Completed','Suspended')),
  start_date        date,
  end_date          date,
  instructor_id     text REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  instructor        text,
  progress_tracking boolean NOT NULL DEFAULT true,
  milestones        text[] NOT NULL DEFAULT '{}',
  property_id       uuid REFERENCES public.properties(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.spa_program_enrollments (
  id                   text PRIMARY KEY,
  program_id           text NOT NULL REFERENCES public.spa_wellness_programs(id) ON DELETE CASCADE,
  guest_id             text NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  guest_name           text NOT NULL,
  enrolled_date        date NOT NULL DEFAULT CURRENT_DATE,
  status               text NOT NULL DEFAULT 'Enrolled'
                       CHECK (status IN ('Enrolled','Completed','Withdrawn')),
  progress             integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes                text,
  property_id          uuid REFERENCES public.properties(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, guest_id)
);

ALTER TABLE public.spa_wellness_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_wellness_programs_authenticated ON public.spa_wellness_programs;
CREATE POLICY spa_wellness_programs_authenticated ON public.spa_wellness_programs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_wellness_programs TO authenticated;

ALTER TABLE public.spa_program_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spa_program_enrollments_authenticated ON public.spa_program_enrollments;
CREATE POLICY spa_program_enrollments_authenticated ON public.spa_program_enrollments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_program_enrollments TO authenticated;

-- ── Seed: programs ───────────────────────────────────────────────────────────

INSERT INTO public.spa_wellness_programs
  (id, name, program_type, description, duration_days, sessions, price, capacity,
   status, start_date, end_date, instructor_id, instructor, milestones)
VALUES
  ('PRG-001', '21-Day Detox Program', 'Detox Program',
   'Comprehensive detox program with nutrition guidance, spa treatments, and lifestyle coaching',
   21, 12, 899, 10, 'Active', '2026-09-01', '2026-09-22',
   NULL, 'Dr. Sarah Miller',
   '{Initial Assessment,Week 1 Check-in,Week 2 Check-in,Final Assessment}'),
  ('PRG-002', 'Stress Relief Retreat', 'Stress Relief',
   'Weekend retreat focusing on meditation, yoga, and relaxation techniques',
   3, 6, 450, 15, 'Active', '2026-09-11', '2026-09-13',
   'THP-005', 'Michael Brown',
   '{Arrival & Orientation,Day 1 Sessions,Day 2 Sessions,Departure}'),
  ('PRG-003', 'Corporate Wellness Challenge', 'Corporate Wellness',
   '8-week team-based wellness competition for corporate groups',
   56, 16, 2500, 30, 'Active', '2026-08-15', '2026-10-10',
   'THP-003', 'Lisa Park',
   '{Kickoff,Week 2,Week 4,Week 6,Final Awards}'),
  ('PRG-004', 'Senior Wellness Program', 'Senior Wellness',
   'Gentle fitness and wellness activities designed for seniors',
   30, 10, 299, 20, 'Upcoming', '2026-10-05', '2026-11-03',
   'THP-001', 'Emily Chen',
   '{Initial Assessment,Week 2,Week 4,Week 6,Final Assessment}'),
  ('PRG-005', 'Fitness Transformation', 'Fitness Transformation',
   'Intensive 6-week fitness program with personal training and nutrition planning',
   42, 24, 1299, 8, 'Active', '2026-09-01', '2026-10-13',
   'THP-002', 'David Miller',
   '{Baseline Assessment,Week 2,Week 4,Week 6,Final Assessment}')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: enrollments (counts match the former mock data) ────────────────────

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-1-' || rn, 'PRG-001', guest_id, guest_name, '2026-09-01', 'Enrolled', 35
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id IN ('GST-001','GST-002','GST-003','GST-004','GST-005',
               'GST-MOCK-001','GST-MOCK-002','GST-MOCK-003')
) g;

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-2-' || rn, 'PRG-002', guest_id, guest_name, '2026-09-10', 'Enrolled', 80
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id IN ('GST-MOCK-001','GST-MOCK-002','GST-MOCK-003','GST-MOCK-004','GST-MOCK-005',
               'GST-MOCK-006','GST-MOCK-007','GST-MOCK-008','GST-001','GST-002','GST-003','GST-004')
) g;

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-3-' || rn, 'PRG-003', guest_id, guest_name, '2026-08-15', 'Enrolled', 45
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id LIKE 'GST-%' AND status <> 'VIP'
  LIMIT 24
) g;

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-5-' || rn, 'PRG-005', guest_id, guest_name, '2026-09-01', 'Enrolled', 55
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id IN ('GST-001','GST-003','GST-005','GST-MOCK-002','GST-MOCK-005','GST-MOCK-007')
) g;
