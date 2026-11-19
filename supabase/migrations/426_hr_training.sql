-- HR Training & Development
-- Supports training sessions and certification compliance tracking.

-- ============================================================================
-- hr_training_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_training_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  staff_count INTEGER NOT NULL DEFAULT 0,
  session_date DATE,
  status      TEXT NOT NULL DEFAULT 'Upcoming'
                CHECK (status IN ('Upcoming', 'Open', 'Full', 'Completed', 'Cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_training_sessions_property ON hr_training_sessions(property_id);

-- ============================================================================
-- hr_certifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_certifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  status_text  TEXT NOT NULL,
  rate         INTEGER,
  target       INTEGER,
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_certifications_property ON hr_certifications(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_training_sessions_updated_at ON hr_training_sessions;
CREATE TRIGGER hr_training_sessions_updated_at
  BEFORE UPDATE ON hr_training_sessions
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_certifications_updated_at ON hr_certifications;
CREATE TRIGGER hr_certifications_updated_at
  BEFORE UPDATE ON hr_certifications
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_training_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_certifications TO authenticated;

ALTER TABLE hr_training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_training_sessions_read ON hr_training_sessions;
CREATE POLICY hr_training_sessions_read ON hr_training_sessions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_training_sessions_write ON hr_training_sessions;
CREATE POLICY hr_training_sessions_write ON hr_training_sessions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_certifications_read ON hr_certifications;
CREATE POLICY hr_certifications_read ON hr_certifications
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_certifications_write ON hr_certifications;
CREATE POLICY hr_certifications_write ON hr_certifications
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
  IF NOT EXISTS (SELECT 1 FROM hr_training_sessions WHERE property_id = v_main AND title = 'Guest Service Excellence') THEN
    INSERT INTO hr_training_sessions (property_id, title, type, staff_count, session_date, status)
    VALUES
      (v_main, 'Guest Service Excellence', 'Soft Skills', 24, '2024-06-02', 'Upcoming'),
      (v_main, 'Food Safety Level 3',      'Compliance',  18, '2024-06-04', 'Open'),
      (v_main, 'First Aid & CPR',          'Safety',      12, '2024-06-08', 'Full'),
      (v_main, 'Advanced PMS Systems',     'Technical',    8, '2024-05-28', 'Completed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM hr_certifications WHERE property_id = v_main AND label = 'Food Handlers Permit') THEN
    INSERT INTO hr_certifications (property_id, label, status_text, rate, target, color)
    VALUES
      (v_main, 'Food Handlers Permit', '98% COMPLIANT', 98, 100, 'emerald'),
      (v_main, 'Active Fire Marshall', '4 PENDING',      4,  4,  'rose'),
      (v_main, 'First Aid Level 2',    '84% VALID',     84, 100, 'indigo'),
      (v_main, 'Security SIA Logs',    'UP TO DATE',   100, 100, 'emerald');
  END IF;
END $$;
