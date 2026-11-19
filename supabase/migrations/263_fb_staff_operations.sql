-- Migration: F&B Staff Operations (Staff Assignment, Outlet Staffing, Shift Requirements, Training, Productivity)
-- Backs the /erp/fb/staff-operations screen. HR owns the employee master (employees table);
-- these tables hold F&B-specific staffing, scheduling, training and productivity records that
-- reference employees(id) and outlets(id).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── fb_staff_assignments ──────────────────────────────────────────
-- A scheduled assignment of an employee to an outlet + shift on a given date.
CREATE TABLE IF NOT EXISTS fb_staff_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  employee_id TEXT NOT NULL,
  outlet_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('Server','Bartender','Chef','Sous Chef','Host','Busser','Manager')),
  shift TEXT NOT NULL CHECK (shift IN ('Morning','Evening','Night')),
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','On Duty','Completed','Absent')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_staff_assignments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_staff_assignments_employee ON fb_staff_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_assignments_outlet ON fb_staff_assignments(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_assignments_date ON fb_staff_assignments(date);

-- ── fb_staffing_requirements ──────────────────────────────────────
-- Per-outlet, per-role, per-meal-period staffing requirement vs. assigned headcount.
CREATE TABLE IF NOT EXISTS fb_staffing_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  role TEXT NOT NULL,
  required_count INTEGER NOT NULL DEFAULT 0,
  assigned_count INTEGER NOT NULL DEFAULT 0,
  meal_period TEXT NOT NULL DEFAULT 'All Day' CHECK (meal_period IN ('Breakfast','Lunch','Dinner','All Day')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_staffing_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_staffing_requirements_outlet ON fb_staffing_requirements(outlet_id);

-- ── fb_shift_requirements ─────────────────────────────────────────
-- Named shift windows per outlet with assigned vs. required headcount.
CREATE TABLE IF NOT EXISTS fb_shift_requirements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  outlet_id TEXT,
  assigned_staff INTEGER NOT NULL DEFAULT 0,
  required_staff INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_shift_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_shift_requirements_outlet ON fb_shift_requirements(outlet_id);

-- ── fb_staff_training ─────────────────────────────────────────────
-- Training course assignments for F&B staff.
CREATE TABLE IF NOT EXISTS fb_staff_training (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  course TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  outlet_id TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Completed','Overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_staff_training ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_staff_training_employee ON fb_staff_training(employee_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_training_status ON fb_staff_training(status);

-- ── fb_staff_productivity ─────────────────────────────────────────
-- Per-employee productivity (covers, revenue, hours, revenue/hour).
CREATE TABLE IF NOT EXISTS fb_staff_productivity (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  employee_id TEXT NOT NULL,
  outlet_id TEXT,
  covers_served INTEGER NOT NULL DEFAULT 0,
  revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  rev_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_staff_productivity ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_staff_productivity_employee ON fb_staff_productivity(employee_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_productivity_outlet ON fb_staff_productivity(outlet_id);

-- ── Foreign keys to outlets(id) ───────────────────────────────────
-- Added so Supabase relationship-qualified joins (outlets!<fk_name>(name)) resolve.
ALTER TABLE fb_staff_assignments ADD CONSTRAINT fb_staff_assignments_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_staffing_requirements ADD CONSTRAINT fb_staffing_requirements_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_shift_requirements ADD CONSTRAINT fb_shift_requirements_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_staff_training ADD CONSTRAINT fb_staff_training_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
ALTER TABLE fb_staff_productivity ADD CONSTRAINT fb_staff_productivity_outlet_id_fkey
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;

-- ── Permission ────────────────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
SELECT 'perm_fb_staff_manage', 'fb:staff:manage', 'fnb', 'Manage F&B staff operations (assignments, staffing, shifts, training, productivity)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'fb:staff:manage');

-- Grant to full-access roles for completeness (these roles bypass checks in app code,
-- but granting keeps the permission table consistent for non-bypass roles / audits).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fb:staff:manage'
WHERE r.name IN ('admin','super_admin','executive','general_manager','owner','fb_manager')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ── Seed: F&B employees (HR master) ───────────────────────────────
-- Only insert employees that do not already exist (by id).
INSERT INTO employees (id, name, email, phone, department, position, status, hire_date, salary)
SELECT * FROM (VALUES
  ('emp-001','Marco Rossi','marco@hotel.com','+1-555-0101','Food & Beverage','Chef','Active','2024-01-15'::date, 52000),
  ('emp-002','Sara Ahmed','sara@hotel.com','+1-555-0102','Food & Beverage','Server','Active','2024-03-01'::date, 34000),
  ('emp-003','Luca Bianchi','luca@hotel.com','+1-555-0103','Food & Beverage','Sous Chef','Active','2024-02-10'::date, 41000),
  ('emp-004','Ana Costa','ana@hotel.com','+1-555-0104','Food & Beverage','Bartender','Active','2024-04-05'::date, 36000),
  ('emp-005','James Brown','james@hotel.com','+1-555-0105','Food & Beverage','Host','Active','2024-05-12'::date, 30000),
  ('emp-006','Yui Nakamura','yui@hotel.com','+1-555-0106','Food & Beverage','Server','Active','2024-06-20'::date, 34000),
  ('emp-007','Pedro Silva','pedro@hotel.com','+1-555-0107','Food & Beverage','Busser','Active','2024-07-01'::date, 28000)
) AS v(id, name, email, phone, department, position, status, hire_date, salary)
WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = v.id);

-- ── Seed: Staff assignments ───────────────────────────────────────
-- Outlet id map: MAIN=8f7a343f..., La Maison Restaurant=8ad72723..., Sky Lounge Bar=907e8a05..., Room Service=4a3f6574...
INSERT INTO fb_staff_assignments (id, employee_id, outlet_id, role, shift, date, status)
SELECT * FROM (VALUES
  ('ASG-01','emp-001','8ad72723-fb18-43b2-9333-6cc6f709f749','Chef','Evening','2026-08-12'::date,'On Duty'),
  ('ASG-02','emp-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Server','Evening','2026-08-12'::date,'On Duty'),
  ('ASG-03','emp-003','8ad72723-fb18-43b2-9333-6cc6f709f749','Sous Chef','Evening','2026-08-12'::date,'On Duty'),
  ('ASG-04','emp-004','907e8a05-57f7-4159-81d3-ad53a1745fa3','Bartender','Evening','2026-08-12'::date,'Scheduled'),
  ('ASG-05','emp-005','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Host','Evening','2026-08-12'::date,'On Duty'),
  ('ASG-06','emp-006','8ad72723-fb18-43b2-9333-6cc6f709f749','Server','Evening','2026-08-12'::date,'Absent'),
  ('ASG-07','emp-007','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Busser','Morning','2026-08-12'::date,'Completed')
) AS v(id, employee_id, outlet_id, role, shift, date, status)
WHERE NOT EXISTS (SELECT 1 FROM fb_staff_assignments a WHERE a.id = v.id);

-- ── Seed: Staffing requirements ───────────────────────────────────
INSERT INTO fb_staffing_requirements (id, outlet_id, role, required_count, assigned_count, meal_period)
SELECT * FROM (VALUES
  ('SF-01','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Server',6,5,'Dinner'),
  ('SF-02','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Chef',3,3,'Dinner'),
  ('SF-03','8ad72723-fb18-43b2-9333-6cc6f709f749','Server',4,3,'Dinner'),
  ('SF-04','907e8a05-57f7-4159-81d3-ad53a1745fa3','Bartender',2,2,'All Day'),
  ('SF-05','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Server',3,2,'All Day'),
  ('SF-06','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Host',1,1,'Breakfast')
) AS v(id, outlet_id, role, required_count, assigned_count, meal_period)
WHERE NOT EXISTS (SELECT 1 FROM fb_staffing_requirements s WHERE s.id = v.id);

-- ── Seed: Shift requirements ──────────────────────────────────────
INSERT INTO fb_shift_requirements (id, name, start_time, end_time, outlet_id, assigned_staff, required_staff)
SELECT * FROM (VALUES
  ('SH-01','Breakfast','06:00'::time,'14:00'::time,'8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f',4,5),
  ('SH-02','Evening','14:00'::time,'22:00'::time,'8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f',8,8),
  ('SH-03','Evening','16:00'::time,'23:30'::time,'8ad72723-fb18-43b2-9333-6cc6f709f749',5,6),
  ('SH-04','Night','22:00'::time,'06:00'::time,'4a3f6574-bde9-47e4-bf8d-1b0c64ca6841',2,3),
  ('SH-05','All Day','12:00'::time,'01:00'::time,'907e8a05-57f7-4159-81d3-ad53a1745fa3',3,3)
) AS v(id, name, start_time, end_time, outlet_id, assigned_staff, required_staff)
WHERE NOT EXISTS (SELECT 1 FROM fb_shift_requirements s WHERE s.id = v.id);

-- ── Seed: Training ────────────────────────────────────────────────
INSERT INTO fb_staff_training (id, course, employee_id, outlet_id, due_date, status)
SELECT * FROM (VALUES
  ('TR-01','Food Safety & HACCP','emp-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-08-20'::date,'In Progress'),
  ('TR-02','Wine Service Excellence','emp-006','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-08-15'::date,'Overdue'),
  ('TR-03','POS Operation','emp-007','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-09-01'::date,'Not Started'),
  ('TR-04','Allergen Handling','emp-005','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','2026-07-30'::date,'Completed'),
  ('TR-05','Cocktail Masterclass','emp-004','907e8a05-57f7-4159-81d3-ad53a1745fa3','2026-08-25'::date,'In Progress'),
  ('TR-06','Customer Service Standards','emp-003','8ad72723-fb18-43b2-9333-6cc6f709f749','2026-09-10'::date,'Not Started')
) AS v(id, course, employee_id, outlet_id, due_date, status)
WHERE NOT EXISTS (SELECT 1 FROM fb_staff_training t WHERE t.id = v.id);

-- ── Seed: Productivity ────────────────────────────────────────────
INSERT INTO fb_staff_productivity (id, employee_id, outlet_id, covers_served, revenue, hours, rev_per_hour)
SELECT * FROM (VALUES
  ('PR-01','emp-002','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f',28,1240.00,8,155.00),
  ('PR-02','emp-006','8ad72723-fb18-43b2-9333-6cc6f709f749',18,1620.00,8,202.50),
  ('PR-03','emp-005','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f',0,0.00,8,0.00),
  ('PR-04','emp-004','907e8a05-57f7-4159-81d3-ad53a1745fa3',42,980.00,8,122.50),
  ('PR-05','emp-007','8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f',35,870.00,8,108.75)
) AS v(id, employee_id, outlet_id, covers_served, revenue, hours, rev_per_hour)
WHERE NOT EXISTS (SELECT 1 FROM fb_staff_productivity p WHERE p.id = v.id);
