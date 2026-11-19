-- HR Applicant Tracking System (ATS)
-- Interviews and offers for the HR > ATS module. The candidates themselves
-- already live in hr_candidates (migration 412); this migration adds the two
-- remaining ATS entities that the placeholder ApplicantTracking.tsx renders:
--   hr_interviews — scheduled interviews linked to a candidate
--   hr_offers      — job offers linked to a candidate
--
-- Both tables are property-scoped and follow the same RLS / grant pattern as
-- hr_job_openings and hr_candidates.

-- ============================================================================
-- hr_interviews
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_interviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  candidate_id    UUID REFERENCES hr_candidates(id) ON DELETE CASCADE,
  candidate_name  TEXT NOT NULL,
  position        TEXT,
  type            TEXT NOT NULL DEFAULT 'HR Interview'
                    CHECK (type IN ('HR Interview', 'Technical Interview', 'Practical Assessment', 'Final Interview', 'Phone Screen')),
  scheduled_date  DATE NOT NULL,
  scheduled_time  TEXT NOT NULL,
  interviewer     TEXT,
  location        TEXT,
  status          TEXT NOT NULL DEFAULT 'Scheduled'
                    CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'No Show')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_interviews_property ON hr_interviews(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_interviews_candidate ON hr_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_hr_interviews_date ON hr_interviews(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_hr_interviews_status ON hr_interviews(status);

-- ============================================================================
-- hr_offers
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  candidate_id    UUID REFERENCES hr_candidates(id) ON DELETE CASCADE,
  candidate_name  TEXT NOT NULL,
  position        TEXT,
  department      TEXT,
  salary          NUMERIC DEFAULT 0,
  start_date      DATE,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Accepted', 'Declined', 'Withdrawn')),
  sent_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  response_date   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_offers_property ON hr_offers(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_offers_candidate ON hr_offers(candidate_id);
CREATE INDEX IF NOT EXISTS idx_hr_offers_status ON hr_offers(status);

-- ============================================================================
-- updated_at triggers (reuse the function from migration 412)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_interviews_updated_at ON hr_interviews;
CREATE TRIGGER hr_interviews_updated_at
  BEFORE UPDATE ON hr_interviews
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_offers_updated_at ON hr_offers;
CREATE TRIGGER hr_offers_updated_at
  BEFORE UPDATE ON hr_offers
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_interviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_offers      TO authenticated;

ALTER TABLE hr_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_offers      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_interviews_read ON hr_interviews;
CREATE POLICY hr_interviews_read ON hr_interviews
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_offers_read ON hr_offers;
CREATE POLICY hr_offers_read ON hr_offers
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_interviews_write ON hr_interviews;
CREATE POLICY hr_interviews_write ON hr_interviews
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

DROP POLICY IF EXISTS hr_offers_write ON hr_offers;
CREATE POLICY hr_offers_write ON hr_offers
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
-- Mirrors the placeholder data that was hardcoded in ApplicantTracking.tsx
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_john UUID;
  v_maria UUID;
  v_carlos UUID;
  v_elena UUID;
  v_anna UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM hr_interviews WHERE property_id = v_main_property AND candidate_name = 'John Smith') THEN
    RETURN;
  END IF;

  SELECT id INTO v_john  FROM hr_candidates WHERE property_id = v_main_property AND name = 'John Smith'      LIMIT 1;
  SELECT id INTO v_maria FROM hr_candidates WHERE property_id = v_main_property AND name = 'Maria Garcia'    LIMIT 1;
  SELECT id INTO v_carlos FROM hr_candidates WHERE property_id = v_main_property AND name = 'Carlos Ray'    LIMIT 1;
  SELECT id INTO v_elena FROM hr_candidates WHERE property_id = v_main_property AND name = 'Elena Martinez' LIMIT 1;
  SELECT id INTO v_anna FROM hr_candidates WHERE property_id = v_main_property AND name = 'Anna Kim'         LIMIT 1;

  -- Interviews
  INSERT INTO hr_interviews (property_id, candidate_id, candidate_name, position, type, scheduled_date, scheduled_time, interviewer, location, status)
  VALUES
    (v_main_property, v_john,  'John Smith',      'Front Office Supervisor', 'Technical Interview',  CURRENT_DATE + 2, '10:00 - 11:00', 'Sarah Johnson',  'Conference Room A', 'Scheduled'),
    (v_main_property, v_carlos,'Carlos Ray',      'Senior Sous Chef',        'Practical Assessment', CURRENT_DATE,     '14:00 - 16:00', 'Executive Chef', 'Kitchen',           'Completed'),
    (v_main_property, v_maria, 'Maria Garcia',    'Housekeeping Supervisor','HR Interview',         CURRENT_DATE + 3, '09:00 - 10:00', 'HR Manager',     'HR Office',         'Scheduled');

  -- Offers
  INSERT INTO hr_offers (property_id, candidate_id, candidate_name, position, department, salary, start_date, status, sent_date, response_date)
  VALUES
    (v_main_property, v_carlos, 'Carlos Ray',      'Senior Sous Chef',        'Food & Beverage', 38000, CURRENT_DATE + 15, 'Accepted', CURRENT_DATE - 5, CURRENT_DATE - 4),
    (v_main_property, v_john,   'John Smith',      'Front Office Supervisor', 'Front Office',    42000, CURRENT_DATE + 20, 'Pending',  CURRENT_DATE - 3, NULL),
    (v_main_property, v_anna,   'Anna Kim',        'Front Office Supervisor', 'Front Office',    40000, CURRENT_DATE + 10, 'Declined', CURRENT_DATE - 10, CURRENT_DATE - 8);
END $$;
