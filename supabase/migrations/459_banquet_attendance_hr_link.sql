-- =============================================================================
-- Migration 459: Banquet staff attendance → HR mirror link
-- =============================================================================
-- POST /staff/attendance mirrors each banquet attendance record into the
-- shared HR staff_attendance table (source='Banquet') so payroll and labor
-- cost see banquet hours. This column stores the mirrored row's id so
-- PATCH/DELETE on the banquet record can propagate to the HR record.
-- =============================================================================

ALTER TABLE public.banquet_staff_attendance
  ADD COLUMN IF NOT EXISTS hr_attendance_id text;

CREATE INDEX IF NOT EXISTS idx_banquet_staff_attendance_hr
  ON public.banquet_staff_attendance (hr_attendance_id);
