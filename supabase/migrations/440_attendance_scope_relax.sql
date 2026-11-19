-- Attendance scope relaxation
-- The staff_attendance.department_scope CHECK was progressively extended by
-- migrations 287 (HK/FO) → 292 (+FB) → 340 (+ENG). Any new department
-- (HR, Finance, Sales, Spa, etc.) would currently fail inserts. Replace
-- the enumerated CHECK with a simple NOT NULL so any department scope is
-- accepted, matching the free-text employees.department column.

ALTER TABLE public.staff_attendance DROP CONSTRAINT IF EXISTS staff_attendance_department_scope_check;
ALTER TABLE public.staff_attendance
  ADD CONSTRAINT staff_attendance_department_scope_check
  CHECK (department_scope IS NOT NULL AND department_scope <> '');

-- Backfill department_scope for any rows that may have been blocked previously
-- (defensive — no-op on current data).
UPDATE public.staff_attendance
  SET department_scope = 'GEN'
  WHERE department_scope IS NULL OR department_scope = '';
