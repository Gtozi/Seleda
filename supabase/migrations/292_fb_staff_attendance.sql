-- Migration: F&B Staff Attendance
-- Extends the shared staff_attendance table to support F&B by adding 'FB' to
-- the department_scope CHECK constraint, then seeds attendance records for
-- F&B employees (department = 'Food & Beverage' in the employees table).
--
-- This mirrors what migrations 287–289 did for HK and FO, and backs the
-- Attendance sub-tab added to the F&B Staff Operations module
-- (src/components/FoodBeverage/StaffOperations.tsx).

-- ── 1. Extend department_scope to include 'FB' ────────────────────────
ALTER TABLE staff_attendance DROP CONSTRAINT IF EXISTS staff_attendance_department_scope_check;
ALTER TABLE staff_attendance ADD CONSTRAINT staff_attendance_department_scope_check
  CHECK (department_scope IN ('HK','FO','FB'));

-- ── 2. Seed: last 5 days of attendance for F&B staff ──────────────────
-- Uses the single demo property. staff_id = employee_id (F&B has no separate
-- staff table — it references HR employees directly).
INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, check_in, check_out, status, hours_worked, overtime_hours, employee_id)
SELECT
  'ATT-FB-' || e.id || '-' || (d::date - '2024-01-01'::date),
  '18762279-a389-41c9-9169-7ebc682e9703',
  e.id,
  e.name,
  'FB',
  d,
  CASE WHEN (EXTRACT(DOW FROM d)::int % 3) = 0 THEN 'Evening' WHEN (EXTRACT(DOW FROM d)::int % 3) = 1 THEN 'Night' ELSE 'Morning' END,
  d::timestamptz + INTERVAL '8 hours',
  d::timestamptz + INTERVAL '16 hours',
  CASE WHEN random() < 0.1 THEN 'Late' WHEN random() < 0.05 THEN 'Sick' ELSE 'Present' END,
  8,
  CASE WHEN random() < 0.2 THEN 1 ELSE 0 END,
  e.id
FROM employees e
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '4 days')::date,
  CURRENT_DATE::date,
  INTERVAL '1 day'
) AS d
WHERE e.department = 'Food & Beverage'
  AND e.status = 'Active'
ON CONFLICT (id) DO NOTHING;

-- ── 3. Seed: Day Off / Public Holiday records for F&B staff ───────────
INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, status, hours_worked, overtime_hours, employee_id, notes)
SELECT
  'ATT-FB-OFF-' || e.id || '-' || (d::date - '2024-01-01'::date),
  '18762279-a389-41c9-9169-7ebc682e9703',
  e.id,
  e.name,
  'FB',
  d,
  'Morning',
  CASE WHEN (EXTRACT(DOW FROM d)::int % 7) = 0 THEN 'Public Holiday' ELSE 'Day Off' END,
  0, 0, e.id,
  CASE WHEN (EXTRACT(DOW FROM d)::int % 7) = 0 THEN 'National holiday' ELSE 'Scheduled day off' END
FROM employees e
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '6 days')::date,
  (CURRENT_DATE - INTERVAL '5 days')::date,
  INTERVAL '1 day'
) AS d
WHERE e.department = 'Food & Beverage'
  AND e.status = 'Active'
  AND (EXTRACT(DOW FROM d)::int % 2 = 0)
ON CONFLICT (id) DO NOTHING;
