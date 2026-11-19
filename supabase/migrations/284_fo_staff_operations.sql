-- Migration: Front Office Staff Operations
-- Shift Requirements, Staffing Requirements, Training, Productivity
-- Tailored for Front Office: stations instead of floors/zones,
-- FO-specific roles and productivity metrics (check-ins, check-outs,
-- guest satisfaction, upsell revenue, response time).
-- References employees(id) for HR integration.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── fo_shift_requirements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fo_shift_requirements (
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
ALTER TABLE fo_shift_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fo_shift_requirements_property ON fo_shift_requirements(property_id);

-- ── fo_staffing_requirements ────────────────────────────────────────
-- Per-station, per-role staffing requirement vs. assigned headcount.
CREATE TABLE IF NOT EXISTS fo_staffing_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  station TEXT,
  role TEXT NOT NULL CHECK (role IN ('Front Desk Agent','Concierge','Bell Attendant','Night Auditor','Guest Relations','Cashier','Supervisor')),
  required_count INTEGER NOT NULL DEFAULT 0,
  assigned_count INTEGER NOT NULL DEFAULT 0,
  shift TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN ('Morning','Evening','Night')),
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE fo_staffing_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fo_staffing_requirements_property ON fo_staffing_requirements(property_id);

-- ── fo_staff_training ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fo_staff_training (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  course TEXT NOT NULL,
  employee_id TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Completed','Overdue')),
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE fo_staff_training ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fo_staff_training_employee ON fo_staff_training(employee_id);
CREATE INDEX IF NOT EXISTS idx_fo_staff_training_status ON fo_staff_training(status);

-- ── fo_staff_productivity ───────────────────────────────────────────
-- Per-employee productivity: check-ins, check-outs, guest satisfaction,
-- upsell revenue, avg response time.
CREATE TABLE IF NOT EXISTS fo_staff_productivity (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  employee_id TEXT,
  check_ins INTEGER NOT NULL DEFAULT 0,
  check_outs INTEGER NOT NULL DEFAULT 0,
  guest_satisfaction NUMERIC(5,2) NOT NULL DEFAULT 0,
  upsell_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_response_min NUMERIC(6,2) NOT NULL DEFAULT 0,
  hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  period_date DATE,
  property_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE fo_staff_productivity ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fo_staff_productivity_employee ON fo_staff_productivity(employee_id);

-- ── Seed: Shift requirements ────────────────────────────────────────
INSERT INTO fo_shift_requirements (id, name, start_time, end_time, assigned_staff, required_staff, property_id)
SELECT * FROM (VALUES
  ('FOSH-01','Morning Shift','07:00'::time,'15:00'::time,4,5,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSH-02','Evening Shift','15:00'::time,'23:00'::time,3,3,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSH-03','Night Shift','23:00'::time,'07:00'::time,2,2,'18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, name, start_time, end_time, assigned_staff, required_staff, property_id)
WHERE NOT EXISTS (SELECT 1 FROM fo_shift_requirements s WHERE s.id = v.id);

-- ── Seed: Staffing requirements ─────────────────────────────────────
INSERT INTO fo_staffing_requirements (id, station, role, required_count, assigned_count, shift, property_id)
SELECT * FROM (VALUES
  ('FOSF-01','Front Desk','Front Desk Agent',3,3,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSF-02','Front Desk','Cashier',1,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSF-03','Concierge Desk','Concierge',1,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSF-04','Bell Desk','Bell Attendant',2,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSF-05','Front Desk','Supervisor',1,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSF-06','Front Desk','Night Auditor',1,1,'Night','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOSF-07','Lobby','Guest Relations',1,0,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, station, role, required_count, assigned_count, shift, property_id)
WHERE NOT EXISTS (SELECT 1 FROM fo_staffing_requirements s WHERE s.id = v.id);

-- ── Seed: Training ──────────────────────────────────────────────────
INSERT INTO fo_staff_training (id, course, employee_id, due_date, status, property_id)
SELECT * FROM (VALUES
  ('FOTR-01','PMS System Training','EMP-FO-01','2026-09-15'::date,'Completed','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOTR-02','Guest Service Excellence','EMP-FO-02','2026-08-25'::date,'In Progress','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOTR-03','Cash Handling & Audit','EMP-FO-03','2026-08-10'::date,'Overdue','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOTR-04','Night Audit Procedures','EMP-FO-04','2026-09-01'::date,'Not Started','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOTR-05','Upselling Techniques','EMP-FO-05','2026-10-05'::date,'Not Started','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOTR-06','VIP Guest Handling','EMP-FO-01','2026-09-30'::date,'In Progress','18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, course, employee_id, due_date, status, property_id)
WHERE NOT EXISTS (SELECT 1 FROM fo_staff_training t WHERE t.id = v.id);

-- ── Seed: Productivity ──────────────────────────────────────────────
INSERT INTO fo_staff_productivity (id, employee_id, check_ins, check_outs, guest_satisfaction, upsell_revenue, avg_response_min, hours, period_date, property_id)
SELECT * FROM (VALUES
  ('FOPR-01','EMP-FO-01',18,12,4.80,450.00,3.5,8,'2026-08-20'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOPR-02','EMP-FO-02',15,10,4.50,280.00,4.2,8,'2026-08-20'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOPR-03','EMP-FO-03',8,6,4.20,120.00,5.0,8,'2026-08-20'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOPR-04','EMP-FO-04',3,2,4.60,0.00,2.8,8,'2026-08-20'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('FOPR-05','EMP-FO-05',10,8,4.90,620.00,3.0,8,'2026-08-20'::date,'18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, employee_id, check_ins, check_outs, guest_satisfaction, upsell_revenue, avg_response_min, hours, period_date, property_id)
WHERE NOT EXISTS (SELECT 1 FROM fo_staff_productivity p WHERE p.id = v.id);
