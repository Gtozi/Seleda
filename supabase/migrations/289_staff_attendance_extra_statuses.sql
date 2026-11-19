-- Migration: Add extra attendance statuses + seed Day Off / Public Holiday
-- Extends the status CHECK constraint with: Day Off, Public Holiday,
-- Work From Home, Mission, Training Day.

ALTER TABLE staff_attendance DROP CONSTRAINT IF EXISTS staff_attendance_status_check;
ALTER TABLE staff_attendance ADD CONSTRAINT staff_attendance_status_check
  CHECK (status IN ('Present','Late','Absent','On Leave','Sick','Half Day','Day Off','Public Holiday','Work From Home','Mission','Training Day'));

-- Seed Day Off / Public Holiday records for HK staff
INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, status, hours_worked, overtime_hours, employee_id, notes)
SELECT
  'ATT-HK-OFF-' || s.id || '-' || (d::date - '2024-01-01'::date),
  s.property_id, s.id, s.name, 'HK', d, s.shift,
  CASE WHEN (EXTRACT(DOW FROM d)::int % 7) = 0 THEN 'Public Holiday' ELSE 'Day Off' END,
  0, 0, s.employee_id,
  CASE WHEN (EXTRACT(DOW FROM d)::int % 7) = 0 THEN 'National holiday' ELSE 'Scheduled day off' END
FROM housekeeping_staff s
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '6 days')::date,
  (CURRENT_DATE - INTERVAL '5 days')::date,
  INTERVAL '1 day'
) AS d
WHERE s.is_active = true AND (EXTRACT(DOW FROM d)::int % 2 = 0)
ON CONFLICT (id) DO NOTHING;

-- Seed Day Off / Public Holiday records for FO staff
INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, status, hours_worked, overtime_hours, employee_id, notes)
SELECT
  'ATT-FO-OFF-' || s.id || '-' || (d::date - '2024-01-01'::date),
  s.property_id, s.id, s.name, 'FO', d, s.shift,
  CASE WHEN (EXTRACT(DOW FROM d)::int % 7) = 0 THEN 'Public Holiday' ELSE 'Day Off' END,
  0, 0, s.employee_id,
  CASE WHEN (EXTRACT(DOW FROM d)::int % 7) = 0 THEN 'National holiday' ELSE 'Scheduled day off' END
FROM fo_staff s
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '6 days')::date,
  (CURRENT_DATE - INTERVAL '5 days')::date,
  INTERVAL '1 day'
) AS d
WHERE s.is_active = true AND (EXTRACT(DOW FROM d)::int % 2 = 1)
ON CONFLICT (id) DO NOTHING;
