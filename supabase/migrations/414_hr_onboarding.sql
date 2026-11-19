-- HR Onboarding Management
-- Onboarding checklists, document collection, orientation sessions, and
-- probation tracking for the HR > Onboarding module. Replaces the hardcoded
-- placeholder data in Onboarding.tsx with DB-backed records scoped to a
-- property.
--
-- Tables:
--   hr_onboarding_checklists — per-employee onboarding checklist with JSONB task list
--   hr_onboarding_documents  — document collection tracking (received/pending)
--   hr_orientation_sessions  — scheduled orientation sessions
--   hr_probation_tracking    — probation period tracking with review dates

-- ============================================================================
-- hr_onboarding_checklists
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_onboarding_checklists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_name   TEXT NOT NULL,
  position        TEXT,
  department      TEXT,
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'In Progress', 'Completed', 'On Hold')),
  assigned_to     TEXT,
  tasks           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_onboarding_checklists_property ON hr_onboarding_checklists(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_onboarding_checklists_status  ON hr_onboarding_checklists(status);

-- ============================================================================
-- hr_onboarding_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_onboarding_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_name   TEXT NOT NULL,
  document_name   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Received', 'Verified', 'Missing')),
  received_date   DATE,
  verified_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_onboarding_documents_property ON hr_onboarding_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_onboarding_documents_status  ON hr_onboarding_documents(status);

-- ============================================================================
-- hr_orientation_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_orientation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  session_date    DATE NOT NULL,
  session_time    TEXT NOT NULL,
  location        TEXT,
  facilitator     TEXT,
  attendees       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Scheduled'
                    CHECK (status IN ('Scheduled', 'Completed', 'Cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_orientation_sessions_property ON hr_orientation_sessions(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_orientation_sessions_date     ON hr_orientation_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_hr_orientation_sessions_status   ON hr_orientation_sessions(status);

-- ============================================================================
-- hr_probation_tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_probation_tracking (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_name   TEXT NOT NULL,
  position        TEXT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  review_date     DATE,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Review Due', 'Completed', 'Extended')),
  supervisor      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_probation_tracking_property ON hr_probation_tracking(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_probation_tracking_status  ON hr_probation_tracking(status);

-- ============================================================================
-- updated_at triggers (reuse the function from migration 412)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_onboarding_checklists_updated_at ON hr_onboarding_checklists;
CREATE TRIGGER hr_onboarding_checklists_updated_at
  BEFORE UPDATE ON hr_onboarding_checklists
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_onboarding_documents_updated_at ON hr_onboarding_documents;
CREATE TRIGGER hr_onboarding_documents_updated_at
  BEFORE UPDATE ON hr_onboarding_documents
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_orientation_sessions_updated_at ON hr_orientation_sessions;
CREATE TRIGGER hr_orientation_sessions_updated_at
  BEFORE UPDATE ON hr_orientation_sessions
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_probation_tracking_updated_at ON hr_probation_tracking;
CREATE TRIGGER hr_probation_tracking_updated_at
  BEFORE UPDATE ON hr_probation_tracking
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_onboarding_checklists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_onboarding_documents  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_orientation_sessions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_probation_tracking    TO authenticated;

ALTER TABLE hr_onboarding_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_onboarding_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_orientation_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_probation_tracking    ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user.
DROP POLICY IF EXISTS hr_onboarding_checklists_read ON hr_onboarding_checklists;
CREATE POLICY hr_onboarding_checklists_read ON hr_onboarding_checklists
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_onboarding_documents_read ON hr_onboarding_documents;
CREATE POLICY hr_onboarding_documents_read ON hr_onboarding_documents
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_orientation_sessions_read ON hr_orientation_sessions;
CREATE POLICY hr_orientation_sessions_read ON hr_orientation_sessions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_probation_tracking_read ON hr_probation_tracking;
CREATE POLICY hr_probation_tracking_read ON hr_probation_tracking
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins.
DROP POLICY IF EXISTS hr_onboarding_checklists_write ON hr_onboarding_checklists;
CREATE POLICY hr_onboarding_checklists_write ON hr_onboarding_checklists
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_onboarding_documents_write ON hr_onboarding_documents;
CREATE POLICY hr_onboarding_documents_write ON hr_onboarding_documents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_orientation_sessions_write ON hr_orientation_sessions;
CREATE POLICY hr_orientation_sessions_write ON hr_orientation_sessions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_probation_tracking_write ON hr_probation_tracking;
CREATE POLICY hr_probation_tracking_write ON hr_probation_tracking
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Mock data seed — Gheralta Main Property (GH-MAIN)
-- Mirrors the placeholder data that was hardcoded in Onboarding.tsx
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF EXISTS (SELECT 1 FROM hr_onboarding_checklists WHERE property_id = v_main_property AND employee_name = 'John Doe') THEN
    RETURN;
  END IF;

  -- Onboarding checklists
  INSERT INTO hr_onboarding_checklists (property_id, employee_name, position, department, start_date, status, assigned_to, tasks)
  VALUES
    (v_main_property, 'John Doe', 'Receptionist', 'Front Office', '2024-07-01', 'In Progress', 'Sarah Johnson',
     '[{"item":"Employment Contract","completed":true},{"item":"ID Card Issued","completed":true},{"item":"Uniform Assigned","completed":true},{"item":"System Access","completed":true},{"item":"Orientation Completed","completed":false},{"item":"Department Training","completed":false}]'::jsonb),
    (v_main_property, 'Maria Garcia', 'Room Attendant', 'Housekeeping', '2024-07-05', 'Pending', 'James Chen',
     '[{"item":"Employment Contract","completed":false},{"item":"ID Card Issued","completed":false},{"item":"Uniform Assigned","completed":false},{"item":"System Access","completed":false},{"item":"Orientation Completed","completed":false},{"item":"Department Training","completed":false}]'::jsonb),
    (v_main_property, 'Carlos Ray', 'Line Cook', 'Food & Beverage', '2024-06-28', 'Completed', 'Elena Martinez',
     '[{"item":"Employment Contract","completed":true},{"item":"ID Card Issued","completed":true},{"item":"Uniform Assigned","completed":true},{"item":"System Access","completed":true},{"item":"Orientation Completed","completed":true},{"item":"Department Training","completed":true}]'::jsonb);

  -- Onboarding documents
  INSERT INTO hr_onboarding_documents (property_id, employee_name, document_name, status, received_date, verified_by)
  VALUES
    (v_main_property, 'John Doe', 'Employment Contract', 'Received', '2024-06-25', 'HR Manager'),
    (v_main_property, 'John Doe', 'Passport Copy',       'Received', '2024-06-25', 'HR Manager'),
    (v_main_property, 'John Doe', 'Work Permit',         'Pending',  NULL,          NULL),
    (v_main_property, 'Maria Garcia', 'Employment Contract', 'Pending', NULL, NULL);

  -- Orientation sessions
  INSERT INTO hr_orientation_sessions (property_id, title, session_date, session_time, location, facilitator, attendees, status)
  VALUES
    (v_main_property, 'Company Orientation',                   '2024-07-01', '09:00 - 12:00', 'Conference Room A', 'HR Manager',     5, 'Scheduled'),
    (v_main_property, 'Safety Training',                      '2024-07-01', '14:00 - 16:00', 'Training Room',     'Safety Officer',  5, 'Scheduled'),
    (v_main_property, 'Department Orientation - Front Office', '2024-07-02', '09:00 - 17:00', 'Front Office',      'Sarah Johnson',    1, 'Scheduled');

  -- Probation tracking
  INSERT INTO hr_probation_tracking (property_id, employee_name, position, start_date, end_date, review_date, status, supervisor)
  VALUES
    (v_main_property, 'John Doe',      'Receptionist',          '2024-07-01', '2024-09-30', '2024-08-01', 'Active',     'Sarah Johnson'),
    (v_main_property, 'Elena Smith',   'F&B Supervisor',        '2024-05-01', '2024-07-31', '2024-06-30', 'Review Due', 'Elena Martinez'),
    (v_main_property, 'James Wilson',  'Maintenance Assistant', '2024-04-01', '2024-06-30', '2024-06-01', 'Completed',  'Robert Wilson');
END $$;
