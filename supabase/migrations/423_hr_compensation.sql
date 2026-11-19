-- HR Compensation & Benefits
-- Supports salary grades, benefit plans, allowances, and additional benefits.

-- ============================================================================
-- hr_salary_grades
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_salary_grades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  grade           TEXT NOT NULL,
  level           TEXT NOT NULL,
  min_salary      NUMERIC NOT NULL DEFAULT 0,
  max_salary      NUMERIC NOT NULL DEFAULT 0,
  midpoint        NUMERIC NOT NULL DEFAULT 0,
  positions       INTEGER NOT NULL DEFAULT 0,
  employees       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_salary_grades_property ON hr_salary_grades(property_id);

-- ============================================================================
-- hr_benefit_plans
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_benefit_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL,
  description           TEXT,
  coverage              TEXT,
  employer_contribution NUMERIC NOT NULL DEFAULT 0,
  employee_contribution NUMERIC NOT NULL DEFAULT 0,
  enrolled              INTEGER NOT NULL DEFAULT 0,
  eligible              INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'Active'
                          CHECK (status IN ('Active', 'Inactive', 'Pending')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_benefit_plans_property ON hr_benefit_plans(property_id);

-- ============================================================================
-- hr_allowances
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_allowances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,
  amount            NUMERIC NOT NULL DEFAULT 0,
  eligible_employees INTEGER NOT NULL DEFAULT 0,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_allowances_property ON hr_allowances(property_id);

-- ============================================================================
-- hr_additional_benefits
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_additional_benefits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  description     TEXT,
  coverage        TEXT,
  available       INTEGER,
  occupied        INTEGER,
  waiting_list    INTEGER,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Inactive', 'Available', 'Full')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_additional_benefits_property ON hr_additional_benefits(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_salary_grades_updated_at ON hr_salary_grades;
CREATE TRIGGER hr_salary_grades_updated_at
  BEFORE UPDATE ON hr_salary_grades
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_benefit_plans_updated_at ON hr_benefit_plans;
CREATE TRIGGER hr_benefit_plans_updated_at
  BEFORE UPDATE ON hr_benefit_plans
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_allowances_updated_at ON hr_allowances;
CREATE TRIGGER hr_allowances_updated_at
  BEFORE UPDATE ON hr_allowances
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_additional_benefits_updated_at ON hr_additional_benefits;
CREATE TRIGGER hr_additional_benefits_updated_at
  BEFORE UPDATE ON hr_additional_benefits
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_salary_grades       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_benefit_plans       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_allowances         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_additional_benefits TO authenticated;

ALTER TABLE hr_salary_grades       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_benefit_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_allowances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_additional_benefits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_salary_grades_read ON hr_salary_grades;
CREATE POLICY hr_salary_grades_read ON hr_salary_grades
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_salary_grades_write ON hr_salary_grades;
CREATE POLICY hr_salary_grades_write ON hr_salary_grades
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_benefit_plans_read ON hr_benefit_plans;
CREATE POLICY hr_benefit_plans_read ON hr_benefit_plans
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_benefit_plans_write ON hr_benefit_plans;
CREATE POLICY hr_benefit_plans_write ON hr_benefit_plans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_allowances_read ON hr_allowances;
CREATE POLICY hr_allowances_read ON hr_allowances
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_allowances_write ON hr_allowances;
CREATE POLICY hr_allowances_write ON hr_allowances
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_additional_benefits_read ON hr_additional_benefits;
CREATE POLICY hr_additional_benefits_read ON hr_additional_benefits
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_additional_benefits_write ON hr_additional_benefits;
CREATE POLICY hr_additional_benefits_write ON hr_additional_benefits
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Salary grades
  IF NOT EXISTS (SELECT 1 FROM hr_salary_grades WHERE property_id = v_main AND grade = 'Executive') THEN
    INSERT INTO hr_salary_grades (property_id, grade, level, min_salary, max_salary, midpoint, positions, employees)
    VALUES
      (v_main, 'Executive',         'E1',  120000, 180000, 150000,  5,  5),
      (v_main, 'Senior Management', 'SM1',  85000, 120000, 102500, 12, 10),
      (v_main, 'Management',       'M1',   65000,  85000,  75000, 25, 22),
      (v_main, 'Senior Staff',      'SS1',  45000,  65000,  55000, 45, 40),
      (v_main, 'Staff',             'S1',  32000,  45000,  38500, 161, 151);
  END IF;

  -- Benefit plans
  IF NOT EXISTS (SELECT 1 FROM hr_benefit_plans WHERE property_id = v_main AND name = 'Medical Insurance') THEN
    INSERT INTO hr_benefit_plans (property_id, name, type, description, coverage, employer_contribution, employee_contribution, enrolled, eligible, status)
    VALUES
      (v_main, 'Medical Insurance', 'Health',     'Comprehensive medical coverage for employees and dependents', 'Employee + Family', 80, 20, 198, 248, 'Active'),
      (v_main, 'Life Insurance',    'Life',       'Group life insurance with 3x annual salary coverage',          '3x Salary',        100, 0, 248, 248, 'Active'),
      (v_main, 'Retirement Plan',   'Retirement', '401(k) with employer matching up to 5%',                       'Voluntary',        5,  5, 185, 248, 'Active');
  END IF;

  -- Allowances
  IF NOT EXISTS (SELECT 1 FROM hr_allowances WHERE property_id = v_main AND name = 'Housing Allowance') THEN
    INSERT INTO hr_allowances (property_id, name, type, amount, eligible_employees, description)
    VALUES
      (v_main, 'Housing Allowance',      'Monthly', 500,  45, 'Monthly housing stipend for eligible positions'),
      (v_main, 'Transportation Allowance','Monthly', 150, 120, 'Transportation reimbursement for commuting'),
      (v_main, 'Meal Allowance',         'Daily',   25,  200, 'Daily meal allowance for working shifts'),
      (v_main, 'Uniform Allowance',      'Annual',  300, 248, 'Annual uniform replacement allowance');
  END IF;

  -- Additional benefits
  IF NOT EXISTS (SELECT 1 FROM hr_additional_benefits WHERE property_id = v_main AND name = 'Staff Accommodation') THEN
    INSERT INTO hr_additional_benefits (property_id, name, type, description, coverage, available, occupied, waiting_list, status)
    VALUES
      (v_main, 'Staff Accommodation',     'Housing',  'Staff accommodation for eligible employees', NULL,                    45, 42, 18, 'Available'),
      (v_main, 'Staff Meals',             'Food',     'Complimentary meals during working hours',     'All Staff',             NULL, NULL, NULL, 'Active'),
      (v_main, 'Transportation Benefits', 'Transport','Shuttle service for staff accommodation',     'Accommodation Residents', NULL, NULL, NULL, 'Active');
  END IF;
END $$;
