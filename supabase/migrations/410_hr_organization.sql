-- HR Organization Management
-- Departments, Teams, and Positions for the HR > Organization module.
-- Replaces the hardcoded placeholder data in OrganizationManagement.tsx with
-- DB-backed records scoped to a property. Follows the same multi-property
-- pattern used by the Housekeeping & F&B portals (property_id scoped tables).
--
-- Tables:
--   hr_departments  — property-scoped, self-referencing parent for nesting
--   hr_teams        — belong to a department
--   hr_positions    — property-scoped, belong to a department, self-ref reports_to

-- ============================================================================
-- hr_departments
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT,
  parent_id       UUID REFERENCES hr_departments(id) ON DELETE SET NULL,
  head_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  cost_center     TEXT,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, code)
);

CREATE INDEX IF NOT EXISTS idx_hr_departments_property ON hr_departments(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_departments_parent   ON hr_departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_hr_departments_active   ON hr_departments(is_active);

-- ============================================================================
-- hr_teams
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   UUID NOT NULL REFERENCES hr_departments(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  head_employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS idx_hr_teams_department ON hr_teams(department_id);
CREATE INDEX IF NOT EXISTS idx_hr_teams_active    ON hr_teams(is_active);

-- ============================================================================
-- hr_positions
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_positions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id            UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  department_id          UUID REFERENCES hr_departments(id) ON DELETE SET NULL,
  title                  TEXT NOT NULL,
  code                   TEXT,
  grade                  TEXT NOT NULL DEFAULT 'Staff',
  reports_to_position_id UUID REFERENCES hr_positions(id) ON DELETE SET NULL,
  reports_to_label       TEXT,
  vacancies              INTEGER NOT NULL DEFAULT 0,
  budget                 NUMERIC NOT NULL DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, code)
);

CREATE INDEX IF NOT EXISTS idx_hr_positions_property   ON hr_positions(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_positions_department ON hr_positions(department_id);
CREATE INDEX IF NOT EXISTS idx_hr_positions_reports    ON hr_positions(reports_to_position_id);
CREATE INDEX IF NOT EXISTS idx_hr_positions_active     ON hr_positions(is_active);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION hr_org_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_departments_updated_at ON hr_departments;
CREATE TRIGGER hr_departments_updated_at
  BEFORE UPDATE ON hr_departments
  FOR EACH ROW EXECUTE FUNCTION hr_org_set_updated_at();

DROP TRIGGER IF EXISTS hr_teams_updated_at ON hr_teams;
CREATE TRIGGER hr_teams_updated_at
  BEFORE UPDATE ON hr_teams
  FOR EACH ROW EXECUTE FUNCTION hr_org_set_updated_at();

DROP TRIGGER IF EXISTS hr_positions_updated_at ON hr_positions;
CREATE TRIGGER hr_positions_updated_at
  BEFORE UPDATE ON hr_positions
  FOR EACH ROW EXECUTE FUNCTION hr_org_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_departments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_teams       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_positions   TO authenticated;

ALTER TABLE hr_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_positions   ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (the API layer enforces property scoping).
DROP POLICY IF EXISTS hr_departments_read ON hr_departments;
CREATE POLICY hr_departments_read ON hr_departments
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_teams_read ON hr_teams;
CREATE POLICY hr_teams_read ON hr_teams
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_positions_read ON hr_positions;
CREATE POLICY hr_positions_read ON hr_positions
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins (the server uses the service-role key which bypasses RLS, so
-- these policies guard direct client access only).
DROP POLICY IF EXISTS hr_departments_write ON hr_departments;
CREATE POLICY hr_departments_write ON hr_departments
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'
  ));

DROP POLICY IF EXISTS hr_teams_write ON hr_teams;
CREATE POLICY hr_teams_write ON hr_teams
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'
  ));

DROP POLICY IF EXISTS hr_positions_write ON hr_positions;
CREATE POLICY hr_positions_write ON hr_positions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'
  ));

-- ============================================================================
-- Mock data seed — Gheralta Main Property (GH-MAIN)
-- Mirrors the placeholder data that was hardcoded in OrganizationManagement.tsx
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_dept_fo UUID;
  v_dept_hk UUID;
  v_dept_fb UUID;
  v_dept_eng UUID;
  v_pos_gm UUID;
  v_pos_fom UUID;
  v_pos_chef UUID;
  v_pos_eng_chief UUID;
  v_pos_hk_exec UUID;
BEGIN
  -- Only seed if no departments exist yet for this property.
  IF EXISTS (SELECT 1 FROM hr_departments WHERE property_id = v_main_property) THEN
    RETURN;
  END IF;

  -- Departments
  INSERT INTO hr_departments (id, property_id, name, code, cost_center, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Front Office',  'FO',  'CC-FO-001', 'Guest reception, concierge, and bell services')
  RETURNING id INTO v_dept_fo;

  INSERT INTO hr_departments (id, property_id, name, code, cost_center, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Housekeeping', 'HK', 'CC-HK-001', 'Room attendance, public areas, and laundry')
  RETURNING id INTO v_dept_hk;

  INSERT INTO hr_departments (id, property_id, name, code, cost_center, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Food & Beverage', 'FB', 'CC-FB-001', 'Kitchen, restaurant, room service, and bar')
  RETURNING id INTO v_dept_fb;

  INSERT INTO hr_departments (id, property_id, name, code, cost_center, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Engineering', 'ENG', 'CC-EN-001', 'Maintenance, electrical, and HVAC')
  RETURNING id INTO v_dept_eng;

  -- Teams
  INSERT INTO hr_teams (department_id, name) VALUES
    (v_dept_fo, 'Reception'),
    (v_dept_fo, 'Concierge'),
    (v_dept_fo, 'Bell Services'),
    (v_dept_hk, 'Room Attendants'),
    (v_dept_hk, 'Public Areas'),
    (v_dept_hk, 'Laundry'),
    (v_dept_fb, 'Kitchen'),
    (v_dept_fb, 'Restaurant Service'),
    (v_dept_fb, 'Room Service'),
    (v_dept_fb, 'Bar'),
    (v_dept_eng, 'Maintenance'),
    (v_dept_eng, 'Electrical'),
    (v_dept_eng, 'HVAC');

  -- Positions
  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, reports_to_label, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, NULL,    'General Manager',         'POS-001', 'Executive',         'Board',                 0, 180000)
  RETURNING id INTO v_pos_gm;

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, reports_to_label, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_fo,  'Front Office Manager',    'POS-002', 'Senior Management', NULL, 0, 85000)
  RETURNING id INTO v_pos_fom;

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_fo, 'Receptionist',            'POS-003', 'Staff', 3, 38000);

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, reports_to_label, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_fb, 'Executive Chef',          'POS-004', 'Senior Management', NULL, 0, 95000)
  RETURNING id INTO v_pos_chef;

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_fb, 'Line Cook',               'POS-005', 'Staff', 5, 35000);

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, reports_to_label, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_eng, 'Chief Engineer',         'POS-006', 'Senior Management', NULL, 0, 78000)
  RETURNING id INTO v_pos_eng_chief;

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, reports_to_label, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_hk, 'Executive Housekeeper',   'POS-008', 'Senior Management', NULL, 0, 72000)
  RETURNING id INTO v_pos_hk_exec;

  INSERT INTO hr_positions (id, property_id, department_id, title, code, grade, vacancies, budget)
  VALUES
    (gen_random_uuid(), v_main_property, v_dept_hk, 'Room Attendant',          'POS-007', 'Staff', 8, 32000);

  -- Wire up reporting lines (reports_to_position_id) now that parents exist.
  UPDATE hr_positions SET reports_to_position_id = v_pos_gm    WHERE id = v_pos_fom;
  UPDATE hr_positions SET reports_to_position_id = v_pos_gm    WHERE id = v_pos_chef;
  UPDATE hr_positions SET reports_to_position_id = v_pos_gm    WHERE id = v_pos_eng_chief;
  UPDATE hr_positions SET reports_to_position_id = v_pos_gm    WHERE id = v_pos_hk_exec;
END $$;
