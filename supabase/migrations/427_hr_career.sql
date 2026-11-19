-- HR Career & Succession Planning
-- Tracks career paths, talent pool, succession plans, and internal mobility.

-- ============================================================================
-- hr_career_paths
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_career_paths (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  department      TEXT,
  levels          JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_employees INTEGER NOT NULL DEFAULT 0,
  total_positions  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_career_paths_property ON hr_career_paths(property_id);

-- ============================================================================
-- hr_talent_pool
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_talent_pool (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee           TEXT NOT NULL,
  current_position   TEXT,
  department         TEXT,
  potential          TEXT NOT NULL DEFAULT 'Medium'
                        CHECK (potential IN ('High', 'Medium', 'Low')),
  readiness          TEXT NOT NULL DEFAULT 'Ready in 2-3 Years'
                        CHECK (readiness IN ('Ready Now', 'Ready in 6-12 Months', 'Ready in 1-2 Years', 'Ready in 2-3 Years')),
  target_position    TEXT,
  career_path        TEXT,
  performance_rating NUMERIC(3,1),
  last_review        DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_talent_pool_property ON hr_talent_pool(property_id);

-- ============================================================================
-- hr_succession_plans
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_succession_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  position     TEXT NOT NULL,
  incumbent    TEXT,
  department   TEXT,
  successors   JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level   TEXT NOT NULL DEFAULT 'Low'
                 CHECK (risk_level IN ('Low', 'Medium', 'High')),
  last_updated DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_succession_plans_property ON hr_succession_plans(property_id);

-- ============================================================================
-- hr_internal_mobility
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_internal_mobility (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee           TEXT NOT NULL,
  from_position      TEXT,
  to_position        TEXT,
  department         TEXT,
  status             TEXT NOT NULL DEFAULT 'In Progress'
                       CHECK (status IN ('In Progress', 'Approved', 'Completed', 'Rejected')),
  initiated_date     DATE,
  expected_completion DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_internal_mobility_property ON hr_internal_mobility(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_career_paths_updated_at ON hr_career_paths;
CREATE TRIGGER hr_career_paths_updated_at
  BEFORE UPDATE ON hr_career_paths
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_talent_pool_updated_at ON hr_talent_pool;
CREATE TRIGGER hr_talent_pool_updated_at
  BEFORE UPDATE ON hr_talent_pool
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_succession_plans_updated_at ON hr_succession_plans;
CREATE TRIGGER hr_succession_plans_updated_at
  BEFORE UPDATE ON hr_succession_plans
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_internal_mobility_updated_at ON hr_internal_mobility;
CREATE TRIGGER hr_internal_mobility_updated_at
  BEFORE UPDATE ON hr_internal_mobility
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_career_paths       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_talent_pool        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_succession_plans   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_internal_mobility  TO authenticated;

ALTER TABLE hr_career_paths       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_talent_pool        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_succession_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_internal_mobility  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_career_paths_read ON hr_career_paths;
CREATE POLICY hr_career_paths_read ON hr_career_paths
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_career_paths_write ON hr_career_paths;
CREATE POLICY hr_career_paths_write ON hr_career_paths
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_talent_pool_read ON hr_talent_pool;
CREATE POLICY hr_talent_pool_read ON hr_talent_pool
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_talent_pool_write ON hr_talent_pool;
CREATE POLICY hr_talent_pool_write ON hr_talent_pool
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_succession_plans_read ON hr_succession_plans;
CREATE POLICY hr_succession_plans_read ON hr_succession_plans
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_succession_plans_write ON hr_succession_plans;
CREATE POLICY hr_succession_plans_write ON hr_succession_plans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_internal_mobility_read ON hr_internal_mobility;
CREATE POLICY hr_internal_mobility_read ON hr_internal_mobility
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_internal_mobility_write ON hr_internal_mobility;
CREATE POLICY hr_internal_mobility_write ON hr_internal_mobility
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
  -- Career paths
  IF NOT EXISTS (SELECT 1 FROM hr_career_paths WHERE property_id = v_main AND name = 'Front Office Career Path') THEN
    INSERT INTO hr_career_paths (property_id, name, department, levels, active_employees, total_positions)
    VALUES
      (v_main, 'Front Office Career Path', 'Front Office',
       '[
         {"title": "Receptionist", "duration": "1-2 years", "skills": ["Customer Service", "Communication", "PMS"]},
         {"title": "Senior Receptionist", "duration": "2-3 years", "skills": ["Team Leadership", "Conflict Resolution", "Operations"]},
         {"title": "Front Office Manager", "duration": "3-5 years", "skills": ["Strategic Planning", "Budget Management", "Staff Development"]},
         {"title": "Director of Front Office", "duration": "5+ years", "skills": ["Executive Leadership", "Revenue Management", "Guest Experience"]}
       ]'::jsonb, 45, 52),
      (v_main, 'Culinary Career Path', 'F&B',
       '[
         {"title": "Commis Chef", "duration": "1-2 years", "skills": ["Food Preparation", "Kitchen Safety", "Recipe Execution"]},
         {"title": "Chef de Partie", "duration": "2-3 years", "skills": ["Section Management", "Menu Planning", "Quality Control"]},
         {"title": "Sous Chef", "duration": "3-4 years", "skills": ["Kitchen Operations", "Cost Control", "Team Leadership"]},
         {"title": "Executive Chef", "duration": "4+ years", "skills": ["Culinary Vision", "Financial Management", "Strategic Planning"]}
       ]'::jsonb, 38, 45);
  END IF;

  -- Talent pool
  IF NOT EXISTS (SELECT 1 FROM hr_talent_pool WHERE property_id = v_main AND employee = 'John Doe') THEN
    INSERT INTO hr_talent_pool (property_id, employee, current_position, department, potential, readiness, target_position, career_path, performance_rating, last_review)
    VALUES
      (v_main, 'John Doe',       'Senior Receptionist',     'Front Office', 'High',   'Ready Now',          'Front Office Manager', 'Front Office Career Path', 4.5, '2024-03-15'),
      (v_main, 'Elena Smith',    'Chef de Partie',          'F&B',          'High',   'Ready in 1-2 Years', 'Sous Chef',            'Culinary Career Path',     4.3, '2024-03-20'),
      (v_main, 'Maria Garcia',   'Bell Services Supervisor', 'Front Office', 'Medium', 'Ready in 2-3 Years', 'Front Office Manager', 'Front Office Career Path', 4.0, '2024-03-10');
  END IF;

  -- Succession plans
  IF NOT EXISTS (SELECT 1 FROM hr_succession_plans WHERE property_id = v_main AND position = 'General Manager') THEN
    INSERT INTO hr_succession_plans (property_id, position, incumbent, department, successors, risk_level, last_updated)
    VALUES
      (v_main, 'General Manager',     'Robert Williams', 'Executive',
       '[{"employee": "Sarah Johnson", "readiness": "Ready Now", "status": "Primary"}, {"employee": "Michael Chen", "readiness": "Ready in 1-2 Years", "status": "Backup"}]'::jsonb, 'Low', '2024-06-01'),
      (v_main, 'Executive Chef',      'Elena Martinez',  'F&B',
       '[{"employee": "Carlos Rodriguez", "readiness": "Ready Now", "status": "Primary"}, {"employee": "Anna Kim", "readiness": "Ready in 1-2 Years", "status": "Backup"}]'::jsonb, 'Low', '2024-05-15'),
      (v_main, 'Front Office Manager', 'Sarah Johnson',  'Front Office',
       '[{"employee": "John Doe", "readiness": "Ready in 6-12 Months", "status": "Primary"}, {"employee": "Emily Brown", "readiness": "Ready in 1-2 Years", "status": "Backup"}]'::jsonb, 'Medium', '2024-06-10');
  END IF;

  -- Internal mobility
  IF NOT EXISTS (SELECT 1 FROM hr_internal_mobility WHERE property_id = v_main AND employee = 'James Wilson') THEN
    INSERT INTO hr_internal_mobility (property_id, employee, from_position, to_position, department, status, initiated_date, expected_completion)
    VALUES
      (v_main, 'James Wilson',    'Housekeeping Supervisor',  'Front Office Supervisor', 'Front Office', 'In Progress', '2024-06-01', '2024-07-01'),
      (v_main, 'Lisa Anderson',   'Restaurant Server',          'Room Service Supervisor', 'F&B',          'Approved',    '2024-05-15', '2024-06-15'),
      (v_main, 'David Martinez',  'Maintenance Technician',     'Engineering Supervisor',  'Engineering',  'Completed',   '2024-04-01', '2024-05-01');
  END IF;
END $$;
