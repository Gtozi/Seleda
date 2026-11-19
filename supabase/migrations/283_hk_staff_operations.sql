-- Migration: Housekeeping Staff Operations (Shift Requirements, Training, Staffing Requirements, Productivity)
-- Mirrors the F&B staff operations schema (migration 263) but adapted for Housekeeping:
--   - Uses floors/zones instead of outlets
--   - HK-specific roles (Room Attendant, Public Area Attendant, Laundry Attendant, Supervisor, Houseperson)
--   - References employees(id) for HR integration
-- Backs the /erp/housekeeping/staff screen sub-tabs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── hk_shift_requirements ───────────────────────────────────────────
-- Named shift windows with assigned vs. required headcount.
CREATE TABLE IF NOT EXISTS hk_shift_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  assigned_staff INTEGER NOT NULL DEFAULT 0,
  required_staff INTEGER NOT NULL DEFAULT 0,
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hk_shift_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hk_shift_requirements_property ON hk_shift_requirements(property_id);

-- ── hk_staffing_requirements ────────────────────────────────────────
-- Per-floor/zone, per-role staffing requirement vs. assigned headcount.
CREATE TABLE IF NOT EXISTS hk_staffing_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  floor INTEGER,
  zone TEXT,
  role TEXT NOT NULL CHECK (role IN ('Room Attendant','Public Area Attendant','Laundry Attendant','Supervisor','Houseperson')),
  required_count INTEGER NOT NULL DEFAULT 0,
  assigned_count INTEGER NOT NULL DEFAULT 0,
  shift TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN ('Morning','Evening','Night')),
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hk_staffing_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hk_staffing_requirements_property ON hk_staffing_requirements(property_id);

-- ── hk_staff_training ───────────────────────────────────────────────
-- Training course assignments for housekeeping staff.
CREATE TABLE IF NOT EXISTS hk_staff_training (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  course TEXT NOT NULL,
  employee_id TEXT,
  staff_id TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Completed','Overdue')),
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hk_staff_training ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hk_staff_training_employee ON hk_staff_training(employee_id);
CREATE INDEX IF NOT EXISTS idx_hk_staff_training_staff ON hk_staff_training(staff_id);
CREATE INDEX IF NOT EXISTS idx_hk_staff_training_status ON hk_staff_training(status);

-- ── hk_staff_productivity ───────────────────────────────────────────
-- Per-staff productivity (rooms cleaned, hours, inspection score, productivity score).
CREATE TABLE IF NOT EXISTS hk_staff_productivity (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  employee_id TEXT,
  staff_id TEXT,
  rooms_cleaned INTEGER NOT NULL DEFAULT 0,
  hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  inspection_score INTEGER NOT NULL DEFAULT 0,
  productivity_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  period_date DATE,
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE hk_staff_productivity ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hk_staff_productivity_employee ON hk_staff_productivity(employee_id);
CREATE INDEX IF NOT EXISTS idx_hk_staff_productivity_staff ON hk_staff_productivity(staff_id);

-- ── Seed: Shift requirements ────────────────────────────────────────
INSERT INTO hk_shift_requirements (id, name, start_time, end_time, assigned_staff, required_staff, property_id)
SELECT * FROM (VALUES
  ('HKSH-01','Morning Shift','07:00'::time,'15:00'::time,5,6,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSH-02','Evening Shift','15:00'::time,'23:00'::time,4,4,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSH-03','Night Shift','23:00'::time,'07:00'::time,2,3,'18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, name, start_time, end_time, assigned_staff, required_staff, property_id)
WHERE NOT EXISTS (SELECT 1 FROM hk_shift_requirements s WHERE s.id = v.id);

-- ── Seed: Staffing requirements ─────────────────────────────────────
INSERT INTO hk_staffing_requirements (id, floor, zone, role, required_count, assigned_count, shift, property_id)
SELECT * FROM (VALUES
  ('HKSF-01',1,'Zone A','Room Attendant',3,3,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSF-02',2,'Zone A','Room Attendant',3,2,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSF-03',3,'Zone B','Room Attendant',2,2,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSF-04',NULL,'Zone C','Public Area Attendant',2,2,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSF-05',NULL,'Zone C','Laundry Attendant',2,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKSF-06',NULL,NULL,'Supervisor',1,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, floor, zone, role, required_count, assigned_count, shift, property_id)
WHERE NOT EXISTS (SELECT 1 FROM hk_staffing_requirements s WHERE s.id = v.id);

-- ── Seed: Training ──────────────────────────────────────────────────
INSERT INTO hk_staff_training (id, course, employee_id, staff_id, due_date, status, property_id)
SELECT * FROM (VALUES
  ('HKTR-01','Room Cleaning Standards','EMP-HK-01','HK-01','2026-09-15'::date,'Completed','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKTR-02','Chemical Safety & SDS','EMP-HK-04','HK-04','2026-08-20'::date,'In Progress','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKTR-03','Public Area Sanitation','EMP-HK-07','HK-07','2026-08-10'::date,'Overdue','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKTR-04','Laundry Equipment Operation','EMP-HK-09','HK-09','2026-09-01'::date,'Not Started','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKTR-05','Inspection Checklist Training','EMP-HK-03','HK-03','2026-09-30'::date,'In Progress','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKTR-06','Guest Service Excellence','EMP-HK-02','HK-02','2026-10-05'::date,'Not Started','18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, course, employee_id, staff_id, due_date, status, property_id)
WHERE NOT EXISTS (SELECT 1 FROM hk_staff_training t WHERE t.id = v.id);

-- ── Seed: Productivity ──────────────────────────────────────────────
INSERT INTO hk_staff_productivity (id, employee_id, staff_id, rooms_cleaned, hours, inspection_score, productivity_score, period_date, property_id)
SELECT * FROM (VALUES
  ('HKPR-01','EMP-HK-01','HK-01',12,8,95,93.50,'2026-08-12'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKPR-02','EMP-HK-02','HK-02',10,8,88,86.00,'2026-08-12'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKPR-03','EMP-HK-03','HK-03',6,8,98,97.00,'2026-08-12'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKPR-04','EMP-HK-04','HK-04',11,8,92,91.50,'2026-08-12'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKPR-05','EMP-HK-07','HK-07',0,8,90,90.00,'2026-08-12'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('HKPR-06','EMP-HK-09','HK-09',0,8,85,85.00,'2026-08-12'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, employee_id, staff_id, rooms_cleaned, hours, inspection_score, productivity_score, period_date, property_id)
WHERE NOT EXISTS (SELECT 1 FROM hk_staff_productivity p WHERE p.id = v.id);
