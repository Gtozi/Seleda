-- HR Health & Safety
-- Tracks incidents, safety training, medical exams, PPE, and risk assessments.

-- ============================================================================
-- hr_incidents
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_incidents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'Minor'
                 CHECK (severity IN ('Minor', 'Moderate', 'Major', 'Critical')),
  location     TEXT,
  incident_date DATE,
  employee     TEXT,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'Investigating'
                 CHECK (status IN ('Investigating', 'Closed', 'Open')),
  days_lost    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_incidents_property ON hr_incidents(property_id);

-- ============================================================================
-- hr_safety_training
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_safety_training (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  training_type   TEXT NOT NULL DEFAULT 'Mandatory',
  category        TEXT,
  duration        TEXT,
  frequency       TEXT,
  last_completed  DATE,
  next_due        DATE,
  completion_rate INTEGER NOT NULL DEFAULT 0,
  total_employees INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_safety_training_property ON hr_safety_training(property_id);

-- ============================================================================
-- hr_medical_exams
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_medical_exams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee    TEXT NOT NULL,
  exam_type   TEXT,
  exam_date   DATE,
  result      TEXT,
  next_exam   DATE,
  status      TEXT NOT NULL DEFAULT 'Valid'
                CHECK (status IN ('Valid', 'Review Required', 'Expired')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_medical_exams_property ON hr_medical_exams(property_id);

-- ============================================================================
-- hr_ppe
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_ppe (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  item             TEXT NOT NULL,
  category         TEXT,
  total_issued     INTEGER NOT NULL DEFAULT 0,
  in_use           INTEGER NOT NULL DEFAULT 0,
  needs_replacement INTEGER NOT NULL DEFAULT 0,
  last_inspection  DATE,
  status           TEXT NOT NULL DEFAULT 'Good'
                     CHECK (status IN ('Good', 'Fair', 'Low Stock', 'Out of Stock')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_ppe_property ON hr_ppe(property_id);

-- ============================================================================
-- hr_risk_assessments
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_risk_assessments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  area             TEXT NOT NULL,
  hazard_level     TEXT NOT NULL DEFAULT 'Low'
                     CHECK (hazard_level IN ('Low', 'Medium', 'High')),
  last_assessment  DATE,
  next_assessment  DATE,
  status           TEXT NOT NULL DEFAULT 'Valid'
                     CHECK (status IN ('Valid', 'Review Required')),
  controls         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_risk_assessments_property ON hr_risk_assessments(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_incidents_updated_at ON hr_incidents;
CREATE TRIGGER hr_incidents_updated_at
  BEFORE UPDATE ON hr_incidents
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_safety_training_updated_at ON hr_safety_training;
CREATE TRIGGER hr_safety_training_updated_at
  BEFORE UPDATE ON hr_safety_training
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_medical_exams_updated_at ON hr_medical_exams;
CREATE TRIGGER hr_medical_exams_updated_at
  BEFORE UPDATE ON hr_medical_exams
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_ppe_updated_at ON hr_ppe;
CREATE TRIGGER hr_ppe_updated_at
  BEFORE UPDATE ON hr_ppe
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_risk_assessments_updated_at ON hr_risk_assessments;
CREATE TRIGGER hr_risk_assessments_updated_at
  BEFORE UPDATE ON hr_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_incidents         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_safety_training   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_medical_exams     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_ppe               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_risk_assessments  TO authenticated;

ALTER TABLE hr_incidents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_safety_training   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_medical_exams     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_ppe               ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_risk_assessments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_incidents_read ON hr_incidents;
CREATE POLICY hr_incidents_read ON hr_incidents
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_incidents_write ON hr_incidents;
CREATE POLICY hr_incidents_write ON hr_incidents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_safety_training_read ON hr_safety_training;
CREATE POLICY hr_safety_training_read ON hr_safety_training
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_safety_training_write ON hr_safety_training;
CREATE POLICY hr_safety_training_write ON hr_safety_training
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_medical_exams_read ON hr_medical_exams;
CREATE POLICY hr_medical_exams_read ON hr_medical_exams
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_medical_exams_write ON hr_medical_exams;
CREATE POLICY hr_medical_exams_write ON hr_medical_exams
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_ppe_read ON hr_ppe;
CREATE POLICY hr_ppe_read ON hr_ppe
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_ppe_write ON hr_ppe;
CREATE POLICY hr_ppe_write ON hr_ppe
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_risk_assessments_read ON hr_risk_assessments;
CREATE POLICY hr_risk_assessments_read ON hr_risk_assessments
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_risk_assessments_write ON hr_risk_assessments;
CREATE POLICY hr_risk_assessments_write ON hr_risk_assessments
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
  -- Incidents
  IF NOT EXISTS (SELECT 1 FROM hr_incidents WHERE property_id = v_main AND type = 'Slip and Fall') THEN
    INSERT INTO hr_incidents (property_id, type, severity, location, incident_date, employee, description, status, days_lost)
    VALUES
      (v_main, 'Slip and Fall',      'Minor',    'Kitchen',     '2024-06-25', 'John Doe',      'Slipped on wet floor near dishwashing area',                  'Investigating', 0),
      (v_main, 'Equipment Injury',   'Moderate', 'Engineering', '2024-06-20', 'Carlos Ray',    'Minor cut from improper tool handling',                         'Closed',        2),
      (v_main, 'Chemical Exposure',  'Minor',    'Housekeeping','2024-06-15', 'Maria Garcia',  'Minor irritation from cleaning solution',                       'Closed',        0);
  END IF;

  -- Safety training
  IF NOT EXISTS (SELECT 1 FROM hr_safety_training WHERE property_id = v_main AND name = 'Workplace Safety Fundamentals') THEN
    INSERT INTO hr_safety_training (property_id, name, training_type, category, duration, frequency, last_completed, next_due, completion_rate, total_employees, status)
    VALUES
      (v_main, 'Workplace Safety Fundamentals', 'Mandatory',    'General Safety',     '4 hours', 'Annual',    '2024-03-15', '2025-03-15', 95, 248, 'Active'),
      (v_main, 'Food Safety Level 2',           'Mandatory',    'F&B Safety',         '8 hours', 'Biennial',  '2023-11-20', '2025-11-20', 88,  72, 'Active'),
      (v_main, 'Chemical Handling',             'Role-Specific','Hazardous Materials','2 hours', 'Annual',    '2024-01-10', '2025-01-10', 100, 45, 'Active');
  END IF;

  -- Medical exams
  IF NOT EXISTS (SELECT 1 FROM hr_medical_exams WHERE property_id = v_main AND employee = 'John Doe') THEN
    INSERT INTO hr_medical_exams (property_id, employee, exam_type, exam_date, result, next_exam, status)
    VALUES
      (v_main, 'John Doe',      'Pre-Employment', '2021-03-10', 'Fit for Duty',                         '2026-03-10', 'Valid'),
      (v_main, 'Elena Smith',   'Annual',         '2024-01-15', 'Fit for Duty',                         '2025-01-15', 'Valid'),
      (v_main, 'Carlos Ray',    'Return to Work', '2024-06-22', 'Fit for Duty with Restrictions',       '2024-07-22', 'Review Required');
  END IF;

  -- PPE
  IF NOT EXISTS (SELECT 1 FROM hr_ppe WHERE property_id = v_main AND item = 'Safety Helmets') THEN
    INSERT INTO hr_ppe (property_id, item, category, total_issued, in_use, needs_replacement, last_inspection, status)
    VALUES
      (v_main, 'Safety Helmets',       'Head Protection', 150, 142, 8,  '2024-06-01', 'Good'),
      (v_main, 'Safety Shoes',         'Foot Protection', 200, 185, 15, '2024-06-01', 'Good'),
      (v_main, 'Safety Gloves',        'Hand Protection', 300, 280, 20, '2024-06-01', 'Good'),
      (v_main, 'High-Visibility Vests','Body Protection', 100,  95,  5, '2024-06-01', 'Good');
  END IF;

  -- Risk assessments
  IF NOT EXISTS (SELECT 1 FROM hr_risk_assessments WHERE property_id = v_main AND area = 'Kitchen') THEN
    INSERT INTO hr_risk_assessments (property_id, area, hazard_level, last_assessment, next_assessment, status, controls)
    VALUES
      (v_main, 'Kitchen',              'High',   '2024-05-15', '2024-11-15', 'Review Required', 8),
      (v_main, 'Engineering Workshop', 'Medium', '2024-04-20', '2024-10-20', 'Valid',           6),
      (v_main, 'Housekeeping Storage', 'Low',    '2024-06-01', '2024-12-01', 'Valid',           4);
  END IF;
END $$;
