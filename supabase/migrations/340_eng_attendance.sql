-- Migration: Engineering Staff Attendance
-- Extends the shared staff_attendance table to support department_scope='ENG'
-- and seeds 5 days of attendance for the 5 eng_technicians.
--
-- The staff_attendance table was created by migration 287 and extended by 288
-- (employee_id link) and 289 (extra statuses). This migration only:
--   1. Drops/re-adds the department_scope CHECK to include 'ENG'.
--   2. Seeds attendance rows for eng_technicians (department_scope='ENG').

-- ── 1. Extend department_scope CHECK ─────────────────────────────────────
ALTER TABLE public.staff_attendance DROP CONSTRAINT IF EXISTS staff_attendance_department_scope_check;
ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_department_scope_check
  CHECK (department_scope IN ('HK','FO','ENG'));

-- ── 2. Seed: last 5 days of attendance for ENG technicians ───────────────
INSERT INTO public.staff_attendance
  (id, property_id, staff_id, staff_name, department_scope, attendance_date,
   shift, check_in, check_out, status, hours_worked, overtime_hours)
SELECT
  'ATT-ENG-' || t.id || '-' || (d::date - '2024-01-01'::date),
  t.property_id,
  t.id,
  t.name,
  'ENG',
  d,
  t.shift,
  d::timestamptz + INTERVAL '8 hours',
  d::timestamptz + INTERVAL '16 hours',
  CASE
    WHEN random() < 0.08 THEN 'Late'
    WHEN random() < 0.04 THEN 'Absent'
    WHEN random() < 0.06 THEN 'Sick'
    ELSE 'Present'
  END,
  8,
  CASE WHEN random() < 0.15 THEN 1 ELSE 0 END
FROM public.eng_technicians t
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '4 days')::date,
  CURRENT_DATE::date,
  INTERVAL '1 day'
) AS d
WHERE t.is_active = true
ON CONFLICT (id) DO NOTHING;

-- ── 3. Seed: Day Off records for ENG technicians (2 days ago) ────────────
INSERT INTO public.staff_attendance
  (id, property_id, staff_id, staff_name, department_scope, attendance_date,
   shift, status, hours_worked, overtime_hours, notes)
SELECT
  'ATT-ENG-OFF-' || t.id || '-' || (d::date - '2024-01-01'::date),
  t.property_id, t.id, t.name, 'ENG', d, t.shift,
  'Day Off', 0, 0, 'Scheduled day off'
FROM public.eng_technicians t
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '6 days')::date,
  (CURRENT_DATE - INTERVAL '5 days')::date,
  INTERVAL '1 day'
) AS d
WHERE t.is_active = true AND (EXTRACT(DOW FROM d)::int % 2 = 0)
ON CONFLICT (id) DO NOTHING;
