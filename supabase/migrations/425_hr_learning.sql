-- HR Learning & Development
-- Supports learning plans, mandatory training, leadership programs, and history.

-- ============================================================================
-- hr_learning_plans
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_learning_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee          TEXT NOT NULL,
  position          TEXT,
  department        TEXT,
  plan_name         TEXT NOT NULL,
  start_date        DATE,
  end_date          DATE,
  status            TEXT NOT NULL DEFAULT 'In Progress'
                      CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Overdue')),
  progress          INTEGER NOT NULL DEFAULT 0,
  total_courses     INTEGER NOT NULL DEFAULT 0,
  completed_courses INTEGER NOT NULL DEFAULT 0,
  assigned_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_learning_plans_property ON hr_learning_plans(property_id);

-- ============================================================================
-- hr_mandatory_training
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_mandatory_training (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,
  duration            TEXT,
  frequency           TEXT,
  due_date            DATE,
  status              TEXT NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Active', 'Inactive', 'Completed')),
  completion_rate     INTEGER NOT NULL DEFAULT 0,
  total_employees     INTEGER NOT NULL DEFAULT 0,
  completed_employees INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_mandatory_training_property ON hr_mandatory_training(property_id);

-- ============================================================================
-- hr_leadership_programs
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_leadership_programs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  duration     TEXT,
  participants INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'Active'
                 CHECK (status IN ('Active', 'Inactive', 'Completed')),
  start_date   DATE,
  end_date     DATE,
  modules      INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_leadership_programs_property ON hr_leadership_programs(property_id);

-- ============================================================================
-- hr_learning_history
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_learning_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee         TEXT NOT NULL,
  course           TEXT NOT NULL,
  category         TEXT,
  completion_date  DATE,
  status           TEXT NOT NULL DEFAULT 'Completed'
                     CHECK (status IN ('Completed', 'In Progress', 'Failed')),
  score            INTEGER NOT NULL DEFAULT 0,
  certificate      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_learning_history_property ON hr_learning_history(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_learning_plans_updated_at ON hr_learning_plans;
CREATE TRIGGER hr_learning_plans_updated_at
  BEFORE UPDATE ON hr_learning_plans
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_mandatory_training_updated_at ON hr_mandatory_training;
CREATE TRIGGER hr_mandatory_training_updated_at
  BEFORE UPDATE ON hr_mandatory_training
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_leadership_programs_updated_at ON hr_leadership_programs;
CREATE TRIGGER hr_leadership_programs_updated_at
  BEFORE UPDATE ON hr_leadership_programs
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_learning_history_updated_at ON hr_learning_history;
CREATE TRIGGER hr_learning_history_updated_at
  BEFORE UPDATE ON hr_learning_history
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_learning_plans        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_mandatory_training     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leadership_programs    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_learning_history       TO authenticated;

ALTER TABLE hr_learning_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_mandatory_training   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leadership_programs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_learning_history     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_learning_plans_read ON hr_learning_plans;
CREATE POLICY hr_learning_plans_read ON hr_learning_plans
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_learning_plans_write ON hr_learning_plans;
CREATE POLICY hr_learning_plans_write ON hr_learning_plans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_mandatory_training_read ON hr_mandatory_training;
CREATE POLICY hr_mandatory_training_read ON hr_mandatory_training
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_mandatory_training_write ON hr_mandatory_training;
CREATE POLICY hr_mandatory_training_write ON hr_mandatory_training
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_leadership_programs_read ON hr_leadership_programs;
CREATE POLICY hr_leadership_programs_read ON hr_leadership_programs
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_leadership_programs_write ON hr_leadership_programs;
CREATE POLICY hr_leadership_programs_write ON hr_leadership_programs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_learning_history_read ON hr_learning_history;
CREATE POLICY hr_learning_history_read ON hr_learning_history
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_learning_history_write ON hr_learning_history;
CREATE POLICY hr_learning_history_write ON hr_learning_history
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
  -- Learning plans
  IF NOT EXISTS (SELECT 1 FROM hr_learning_plans WHERE property_id = v_main AND plan_name = 'Front Office Excellence') THEN
    INSERT INTO hr_learning_plans (property_id, employee, position, department, plan_name, start_date, end_date, status, progress, total_courses, completed_courses, assigned_by)
    VALUES
      (v_main, 'John Doe',       'Receptionist',  'Front Office', 'Front Office Excellence', '2024-01-15', '2024-06-30', 'In Progress', 75,  8, 6, 'Sarah Johnson'),
      (v_main, 'Elena Smith',     'F&B Supervisor', 'F&B',          'Leadership Development',  '2024-03-01', '2024-09-30', 'In Progress', 45, 12, 5, 'HR Director'),
      (v_main, 'Carlos Ray',      'Line Cook',     'F&B',          'Culinary Skills',         '2024-02-01', '2024-05-31', 'Completed',   100, 6, 6, 'Executive Chef');
  END IF;

  -- Mandatory training
  IF NOT EXISTS (SELECT 1 FROM hr_mandatory_training WHERE property_id = v_main AND name = 'Workplace Safety Fundamentals') THEN
    INSERT INTO hr_mandatory_training (property_id, name, category, duration, frequency, due_date, status, completion_rate, total_employees, completed_employees)
    VALUES
      (v_main, 'Workplace Safety Fundamentals', 'Safety',     '4 hours', 'Annual',    '2024-12-31', 'Active', 95, 248, 236),
      (v_main, 'Food Safety Level 2',           'F&B Safety', '8 hours', 'Biennial',  '2025-11-20', 'Active', 88,  72,  63),
      (v_main, 'Anti-Harassment Training',      'Compliance', '2 hours', 'Annual',    '2024-12-31', 'Active', 92, 248, 228),
      (v_main, 'Data Privacy & Security',       'Compliance', '1 hour',  'Annual',    '2024-12-31', 'Active', 85, 248, 211);
  END IF;

  -- Leadership programs
  IF NOT EXISTS (SELECT 1 FROM hr_leadership_programs WHERE property_id = v_main AND name = 'Emerging Leaders Program') THEN
    INSERT INTO hr_leadership_programs (property_id, name, description, duration, participants, status, start_date, end_date, modules)
    VALUES
      (v_main, 'Emerging Leaders Program',     'Develop future leaders with essential management skills', '6 months',  12, 'Active',    '2024-03-01', '2024-08-31', 8),
      (v_main, 'Executive Leadership Program', 'Advanced leadership training for senior managers',         '12 months', 5,  'Active',    '2024-01-01', '2024-12-31', 15),
      (v_main, 'Team Leadership Essentials',    'Foundational leadership skills for new managers',         '3 months',  18, 'Completed', '2023-09-01', '2023-11-30', 6);
  END IF;

  -- Learning history
  IF NOT EXISTS (SELECT 1 FROM hr_learning_history WHERE property_id = v_main AND course = 'Customer Service Excellence') THEN
    INSERT INTO hr_learning_history (property_id, employee, course, category, completion_date, status, score, certificate)
    VALUES
      (v_main, 'John Doe',       'Customer Service Excellence', 'Hospitality Skills', '2024-05-15', 'Completed', 95, TRUE),
      (v_main, 'Maria Garcia',   'Housekeeping Standards',      'Operations',         '2024-04-20', 'Completed', 88, TRUE),
      (v_main, 'Robert Wilson',  'Electrical Safety',           'Safety',             '2024-03-10', 'Completed', 92, TRUE);
  END IF;
END $$;
