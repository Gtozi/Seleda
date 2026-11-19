-- Migration: Staff Attendance (shared by Housekeeping and Front Office)
-- Tracks daily check-in / check-out per staff member with status and hours.
-- department_scope: 'HK' or 'FO' — lets both portals query their own rows
-- while keeping a single table for cross-department reporting.

CREATE TABLE IF NOT EXISTS staff_attendance (
  id              TEXT PRIMARY KEY,
  property_id     UUID NOT NULL,
  staff_id        TEXT NOT NULL,          -- references housekeeping_staff.id or fo_staff.id
  staff_name      TEXT NOT NULL,          -- denormalized for fast listing
  department_scope TEXT NOT NULL DEFAULT 'HK' CHECK (department_scope IN ('HK','FO')),
  attendance_date DATE NOT NULL,
  shift           TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN ('Morning','Evening','Night')),
  check_in        TIMESTAMPTZ,
  check_out       TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'Present' CHECK (status IN ('Present','Late','Absent','On Leave','Sick','Half Day')),
  hours_worked    NUMERIC(5,2) DEFAULT 0,
  overtime_hours  NUMERIC(5,2) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_staff_date UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_property ON staff_attendance(property_id);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON staff_attendance(staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON staff_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_scope ON staff_attendance(department_scope);

-- ── Seed: last 5 days of attendance for HK staff ──────────────────────
INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, check_in, check_out, status, hours_worked, overtime_hours)
SELECT
  'ATT-HK-' || s.id || '-' || (d::date - '2024-01-01'::date),
  s.property_id,
  s.id,
  s.name,
  'HK',
  d,
  s.shift,
  d::timestamptz + INTERVAL '8 hours',
  d::timestamptz + INTERVAL '16 hours',
  CASE WHEN random() < 0.1 THEN 'Late' WHEN random() < 0.05 THEN 'Absent' ELSE 'Present' END,
  8,
  CASE WHEN random() < 0.2 THEN 1 ELSE 0 END
FROM housekeeping_staff s
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '4 days')::date,
  CURRENT_DATE::date,
  INTERVAL '1 day'
) AS d
WHERE s.is_active = true
ON CONFLICT (id) DO NOTHING;

-- ── Seed: last 5 days of attendance for FO staff ──────────────────────
INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, check_in, check_out, status, hours_worked, overtime_hours)
SELECT
  'ATT-FO-' || s.id || '-' || (d::date - '2024-01-01'::date),
  s.property_id,
  s.id,
  s.name,
  'FO',
  d,
  s.shift,
  d::timestamptz + INTERVAL '8 hours',
  d::timestamptz + INTERVAL '16 hours',
  CASE WHEN random() < 0.1 THEN 'Late' WHEN random() < 0.05 THEN 'Sick' ELSE 'Present' END,
  8,
  CASE WHEN random() < 0.2 THEN 1 ELSE 0 END
FROM fo_staff s
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '4 days')::date,
  CURRENT_DATE::date,
  INTERVAL '1 day'
) AS d
WHERE s.is_active = true
ON CONFLICT (id) DO NOTHING;
