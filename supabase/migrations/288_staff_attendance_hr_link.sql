-- Migration: Link Staff Attendance to HR Employees
-- Adds employee_id to staff_attendance and back-fills it from the existing
-- housekeeping_staff / fo_staff → employees linkage.

ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS employee_id TEXT;
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON staff_attendance(employee_id);

-- Populate employee_id from housekeeping_staff for HK attendance
UPDATE staff_attendance sa
  SET employee_id = hs.employee_id
  FROM housekeeping_staff hs
  WHERE sa.staff_id = hs.id
    AND sa.department_scope = 'HK'
    AND hs.employee_id IS NOT NULL;

-- Populate employee_id from fo_staff for FO attendance
UPDATE staff_attendance sa
  SET employee_id = fs.employee_id
  FROM fo_staff fs
  WHERE sa.staff_id = fs.id
    AND sa.department_scope = 'FO'
    AND fs.employee_id IS NOT NULL;
