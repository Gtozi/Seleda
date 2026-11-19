-- Migration: Transportation staff attendance scope
-- Extends the shared staff_attendance.department_scope CHECK to include 'TR'
-- so completed staff transport trips can mark employee attendance.
-- Keeps every scope introduced by earlier migrations (287: HK/FO,
-- 292: FB, 340: ENG) to avoid silently narrowing the constraint again.

ALTER TABLE public.staff_attendance DROP CONSTRAINT IF EXISTS staff_attendance_department_scope_check;
ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_department_scope_check
  CHECK (department_scope IN ('HK','FO','FB','ENG','TR'));
