-- HR Recruitment Management
-- Job openings (vacancies) and candidates (applicants) for the HR > Recruitment
-- module. Replaces the hardcoded placeholder data in RecruitmentFlow.tsx with
-- DB-backed records scoped to a property. Follows the same multi-property
-- pattern used by the Housekeeping & F&B portals.
--
-- Tables:
--   hr_job_openings — property-scoped vacancies with priority, applicant/interview counts
--   hr_candidates    — applicants linked to a job opening, with pipeline stage + rating

-- ============================================================================
-- hr_job_openings
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_job_openings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  department      TEXT NOT NULL,
  position_id     UUID REFERENCES hr_positions(id) ON DELETE SET NULL,
  priority        TEXT NOT NULL DEFAULT 'Medium'
                    CHECK (priority IN ('Low', 'Medium', 'High', 'Emergency')),
  status          TEXT NOT NULL DEFAULT 'Open'
                    CHECK (status IN ('Open', 'On Hold', 'Closed', 'Filled')),
  description     TEXT,
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_job_openings_property ON hr_job_openings(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_job_openings_status   ON hr_job_openings(status);
CREATE INDEX IF NOT EXISTS idx_hr_job_openings_priority  ON hr_job_openings(priority);

-- ============================================================================
-- hr_candidates
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  job_opening_id  UUID REFERENCES hr_job_openings(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  location        TEXT,
  position        TEXT,
  department      TEXT,
  stage           TEXT NOT NULL DEFAULT 'Application Received'
                    CHECK (stage IN ('Application Received', 'Screening', 'Interview', 'Assessment', 'Background Check', 'Offer', 'Hired', 'Rejected')),
  rating          NUMERIC DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Hired', 'Rejected', 'Withdrew')),
  applied_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_candidates_property ON hr_candidates(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_candidates_job      ON hr_candidates(job_opening_id);
CREATE INDEX IF NOT EXISTS idx_hr_candidates_stage    ON hr_candidates(stage);
CREATE INDEX IF NOT EXISTS idx_hr_candidates_status   ON hr_candidates(status);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
CREATE OR REPLACE FUNCTION hr_recruit_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_job_openings_updated_at ON hr_job_openings;
CREATE TRIGGER hr_job_openings_updated_at
  BEFORE UPDATE ON hr_job_openings
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_candidates_updated_at ON hr_candidates;
CREATE TRIGGER hr_candidates_updated_at
  BEFORE UPDATE ON hr_candidates
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_job_openings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_candidates    TO authenticated;

ALTER TABLE hr_job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_candidates    ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (the API layer enforces property scoping).
DROP POLICY IF EXISTS hr_job_openings_read ON hr_job_openings;
CREATE POLICY hr_job_openings_read ON hr_job_openings
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_candidates_read ON hr_candidates;
CREATE POLICY hr_candidates_read ON hr_candidates
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins (the server uses the service-role key which bypasses RLS).
DROP POLICY IF EXISTS hr_job_openings_write ON hr_job_openings;
CREATE POLICY hr_job_openings_write ON hr_job_openings
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

DROP POLICY IF EXISTS hr_candidates_write ON hr_candidates;
CREATE POLICY hr_candidates_write ON hr_candidates
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
-- Mirrors the placeholder data that was hardcoded in RecruitmentFlow.tsx
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_opening_fb UUID;
  v_opening_fo UUID;
  v_opening_kit UUID;
  v_opening_hk UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM hr_job_openings WHERE property_id = v_main_property AND title = 'Assistant F&B Manager') THEN
    RETURN;
  END IF;

  -- Job openings
  INSERT INTO hr_job_openings (id, property_id, title, department, priority, status, posted_at, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Assistant F&B Manager', 'Food & Beverage', 'High', 'Open', NOW() - INTERVAL '4 days', 'Support the F&B Manager in overseeing restaurant, bar, and room service operations.')
  RETURNING id INTO v_opening_fb;

  INSERT INTO hr_job_openings (id, property_id, title, department, priority, status, posted_at, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Front Office Supervisor', 'Front Office', 'Medium', 'Open', NOW() - INTERVAL '7 days', 'Supervise reception, concierge, and bell desk teams across shifts.')
  RETURNING id INTO v_opening_fo;

  INSERT INTO hr_job_openings (id, property_id, title, department, priority, status, posted_at, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Senior Sous Chef', 'Food & Beverage', 'Emergency', 'Open', NOW() - INTERVAL '2 days', 'Lead the hot kitchen in the absence of the Executive Chef. Immediate start.')
  RETURNING id INTO v_opening_kit;

  INSERT INTO hr_job_openings (id, property_id, title, department, priority, status, posted_at, description)
  VALUES
    (gen_random_uuid(), v_main_property, 'Housekeeping Supervisor', 'Housekeeping', 'Medium', 'Open', NOW() - INTERVAL '10 days', 'Oversee room attendants, public areas, and laundry teams.')
  RETURNING id INTO v_opening_hk;

  -- Candidates for Assistant F&B Manager
  INSERT INTO hr_candidates (property_id, job_opening_id, name, email, phone, location, position, department, stage, rating, status, applied_date)
  VALUES
    (v_main_property, v_opening_fb, 'Marcus Aurelius',  'marcus.a@email.com', '+1 555 0201', 'New York, USA', 'Assistant F&B Manager', 'Food & Beverage', 'Offer', 94, 'Active', '2024-06-10'),
    (v_main_property, v_opening_fb, 'Diana Prince',    'diana.p@email.com',  '+1 555 0202', 'Boston, USA',   'Assistant F&B Manager', 'Food & Beverage', 'Interview', 88, 'Active', '2024-06-15'),
    (v_main_property, v_opening_fb, 'Clark Kent',      'clark.k@email.com',  '+1 555 0203', 'New York, USA', 'Assistant F&B Manager', 'Food & Beverage', 'Screening', 76, 'Active', '2024-06-18');

  -- Candidates for Front Office Supervisor
  INSERT INTO hr_candidates (property_id, job_opening_id, name, email, phone, location, position, department, stage, rating, status, applied_date)
  VALUES
    (v_main_property, v_opening_fo, 'John Smith',      'john.smith@email.com', '+1 555 0204', 'New York, USA', 'Front Office Supervisor', 'Front Office', 'Interview', 90, 'Active', '2024-06-15'),
    (v_main_property, v_opening_fo, 'Anna Kim',        'anna.kim@email.com',   '+1 555 0205', 'Newark, USA',   'Front Office Supervisor', 'Front Office', 'Screening', 82, 'Active', '2024-06-20');

  -- Candidates for Senior Sous Chef
  INSERT INTO hr_candidates (property_id, job_opening_id, name, email, phone, location, position, department, stage, rating, status, applied_date)
  VALUES
    (v_main_property, v_opening_kit, 'Carlos Ray',     'carlos.ray@email.com', '+1 555 0206', 'New York, USA', 'Senior Sous Chef', 'Food & Beverage', 'Offer', 96, 'Active', '2024-06-10'),
    (v_main_property, v_opening_kit, 'Elena Martinez', 'elena.m@email.com',    '+1 555 0207', 'New York, USA', 'Senior Sous Chef', 'Food & Beverage', 'Hired', 98, 'Hired', '2024-06-05');

  -- Candidates for Housekeeping Supervisor
  INSERT INTO hr_candidates (property_id, job_opening_id, name, email, phone, location, position, department, stage, rating, status, applied_date)
  VALUES
    (v_main_property, v_opening_hk, 'Maria Garcia',   'maria.g@email.com',    '+1 555 0208', 'New York, USA', 'Housekeeping Supervisor', 'Housekeeping', 'Screening', 80, 'Active', '2024-06-18'),
    (v_main_property, v_opening_hk, 'James Lee',      'james.lee@email.com',  '+1 555 0209', 'New York, USA', 'Housekeeping Supervisor', 'Housekeeping', 'Application Received', 72, 'Active', '2024-06-22');
END $$;
