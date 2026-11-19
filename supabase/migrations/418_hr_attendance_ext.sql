-- HR Attendance Management — extensions
-- Extends the shared staff_attendance table to support the full spec
-- (Section 12 of Human Resources & Payroll Portal new.md):
--   * Attendance Sources (Biometric, RFID, Mobile, Web, Manual)
--   * Attendance Approval workflow (Pending, Approved, Rejected)
--   * Early Departure flag (manager-marked)
--   * Missing Punch flag (manager-marked; also computed on read)
--   * Manual entry audit (created_by)

ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS source           TEXT NOT NULL DEFAULT 'Manual'
    CHECK (source IN ('Biometric', 'RFID', 'Mobile', 'Web', 'Manual')),
  ADD COLUMN IF NOT EXISTS approval_status  TEXT NOT NULL DEFAULT 'Pending'
    CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
  ADD COLUMN IF NOT EXISTS early_departure  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS missing_punch     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by      TEXT,
  ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by        TEXT;

-- Indexes for the new workflow columns
CREATE INDEX IF NOT EXISTS idx_attendance_source         ON staff_attendance(source);
CREATE INDEX IF NOT EXISTS idx_attendance_approval      ON staff_attendance(approval_status);
CREATE INDEX IF NOT EXISTS idx_attendance_missing_punch  ON staff_attendance(missing_punch);

-- Backfill existing rows with sensible defaults based on status
UPDATE public.staff_attendance
  SET source = CASE
                 WHEN status IN ('Present', 'Late') THEN 'Biometric'
                 ELSE 'Manual'
               END,
      approval_status = CASE
                           WHEN status IN ('Present', 'Late') AND check_in IS NOT NULL AND check_out IS NOT NULL THEN 'Approved'
                           ELSE 'Pending'
                         END,
      missing_punch = (check_in IS NULL OR check_out IS NULL) AND status IN ('Present', 'Late')
  WHERE source IS NULL OR source = 'Manual';

-- Grant the new columns to authenticated role (existing table grants cover columns)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_attendance TO authenticated;
