-- =============================================================================
-- 491_spa_group_classes.sql
-- Moves the Fitness Center's group classes into spa_wellness_programs so they
-- are managed (and enrolled) through Wellness Programs. Adds schedule/location
-- columns since recurring weekly classes aren't bounded by start/end dates.
-- =============================================================================

ALTER TABLE public.spa_wellness_programs
  ADD COLUMN IF NOT EXISTS schedule  text,
  ADD COLUMN IF NOT EXISTS location  text;

-- ── Seed: group classes (instructors resolved to the shared staff roster) ────

INSERT INTO public.spa_wellness_programs
  (id, name, program_type, description, duration_days, sessions, price, capacity,
   status, start_date, end_date, instructor_id, instructor, progress_tracking,
   milestones, schedule, location)
VALUES
  ('PRG-006', 'Morning Yoga Flow', 'Yoga',
   'Gentle morning yoga flow to energize your day — all levels welcome',
   7, 3, 0, 15, 'Active', NULL, NULL,
   'THP-005', 'Michael Brown', false, '{}', 'Mon, Wed, Fri 7:00 AM', 'Yoga Studio'),
  ('PRG-007', 'High-Intensity Interval Training', 'HIIT',
   'Fast-paced HIIT circuit class for strength and conditioning',
   7, 2, 0, 20, 'Active', NULL, NULL,
   'THP-004', 'Sarah Johnson', false, '{}', 'Tue, Thu 6:00 PM', 'Fitness Studio'),
  ('PRG-008', 'Spin Class', 'Spin',
   'High-energy indoor cycling class with interval sprints and climbs',
   7, 3, 0, 12, 'Active', NULL, NULL,
   'THP-002', 'David Miller', false, '{}', 'Mon, Wed, Fri 5:30 PM', 'Fitness Studio'),
  ('PRG-009', 'Pilates Core', 'Pilates',
   'Mat-based Pilates focused on core strength, posture, and flexibility',
   7, 2, 0, 10, 'Active', NULL, NULL,
   'THP-001', 'Emily Chen', false, '{}', 'Tue, Thu 9:00 AM', 'Yoga Studio')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: class enrollments (counts match the former mock data) ──────────────

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-6-' || rn, 'PRG-006', guest_id, guest_name, '2026-09-05', 'Enrolled', 0
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id LIKE 'GST-%'
  LIMIT 12
) g;

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-7-' || rn, 'PRG-007', guest_id, guest_name, '2026-09-05', 'Enrolled', 0
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id LIKE 'GST-%'
  LIMIT 18
) g;

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-8-' || rn, 'PRG-008', guest_id, guest_name, '2026-09-05', 'Enrolled', 0
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id LIKE 'GST-%'
  LIMIT 10
) g;

INSERT INTO public.spa_program_enrollments (id, program_id, guest_id, guest_name, enrolled_date, status, progress)
SELECT 'ENR-9-' || rn, 'PRG-009', guest_id, guest_name, '2026-09-05', 'Enrolled', 0
FROM (
  SELECT LPAD(ROW_NUMBER() OVER (ORDER BY id)::int::text, 3, '0') AS rn, id AS guest_id, name AS guest_name
  FROM public.guests
  WHERE id LIKE 'GST-%'
  LIMIT 8
) g;
