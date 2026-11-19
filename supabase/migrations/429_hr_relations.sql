-- HR Employee Relations
-- Tracks disciplinary actions, grievances, recognition programs, awards, and surveys.

-- ============================================================================
-- hr_disciplinary_actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_disciplinary_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee     TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  category     TEXT,
  action_date  DATE,
  issued_by    TEXT,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'Active'
                 CHECK (status IN ('Active', 'Resolved', 'Expired')),
  expiry_date  DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_disciplinary_actions_property ON hr_disciplinary_actions(property_id);

-- ============================================================================
-- hr_grievances
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_grievances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee    TEXT NOT NULL,
  type        TEXT,
  category    TEXT,
  grievance_date DATE,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'Under Investigation'
                CHECK (status IN ('Under Investigation', 'Investigation Complete', 'Resolved', 'Escalated')),
  assigned_to TEXT,
  priority    TEXT NOT NULL DEFAULT 'Medium'
                CHECK (priority IN ('High', 'Medium', 'Low')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_grievances_property ON hr_grievances(property_id);

-- ============================================================================
-- hr_recognition_programs
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_recognition_programs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  program_type    TEXT,
  description     TEXT,
  current_winner  TEXT,
  last_awarded    DATE,
  next_nomination TEXT,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_recognition_programs_property ON hr_recognition_programs(property_id);

-- ============================================================================
-- hr_recent_recognition
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_recent_recognition (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee      TEXT NOT NULL,
  award         TEXT,
  category      TEXT,
  award_date    DATE,
  recognized_by TEXT,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_recent_recognition_property ON hr_recent_recognition(property_id);

-- ============================================================================
-- hr_employee_surveys
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_employee_surveys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  survey_type   TEXT,
  survey_date   DATE,
  response_rate INTEGER,
  participants  INTEGER,
  status        TEXT NOT NULL DEFAULT 'In Progress'
                  CHECK (status IN ('Completed', 'In Progress', 'Draft')),
  overall_score NUMERIC(3,1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_surveys_property ON hr_employee_surveys(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_disciplinary_actions_updated_at ON hr_disciplinary_actions;
CREATE TRIGGER hr_disciplinary_actions_updated_at
  BEFORE UPDATE ON hr_disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_grievances_updated_at ON hr_grievances;
CREATE TRIGGER hr_grievances_updated_at
  BEFORE UPDATE ON hr_grievances
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_recognition_programs_updated_at ON hr_recognition_programs;
CREATE TRIGGER hr_recognition_programs_updated_at
  BEFORE UPDATE ON hr_recognition_programs
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_recent_recognition_updated_at ON hr_recent_recognition;
CREATE TRIGGER hr_recent_recognition_updated_at
  BEFORE UPDATE ON hr_recent_recognition
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_employee_surveys_updated_at ON hr_employee_surveys;
CREATE TRIGGER hr_employee_surveys_updated_at
  BEFORE UPDATE ON hr_employee_surveys
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_disciplinary_actions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_grievances             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_recognition_programs   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_recent_recognition     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employee_surveys       TO authenticated;

ALTER TABLE hr_disciplinary_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_grievances             ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_recognition_programs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_recent_recognition     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_surveys       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_disciplinary_actions_read ON hr_disciplinary_actions;
CREATE POLICY hr_disciplinary_actions_read ON hr_disciplinary_actions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_disciplinary_actions_write ON hr_disciplinary_actions;
CREATE POLICY hr_disciplinary_actions_write ON hr_disciplinary_actions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_grievances_read ON hr_grievances;
CREATE POLICY hr_grievances_read ON hr_grievances
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_grievances_write ON hr_grievances;
CREATE POLICY hr_grievances_write ON hr_grievances
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_recognition_programs_read ON hr_recognition_programs;
CREATE POLICY hr_recognition_programs_read ON hr_recognition_programs
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_recognition_programs_write ON hr_recognition_programs;
CREATE POLICY hr_recognition_programs_write ON hr_recognition_programs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_recent_recognition_read ON hr_recent_recognition;
CREATE POLICY hr_recent_recognition_read ON hr_recent_recognition
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_recent_recognition_write ON hr_recent_recognition;
CREATE POLICY hr_recent_recognition_write ON hr_recent_recognition
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_employee_surveys_read ON hr_employee_surveys;
CREATE POLICY hr_employee_surveys_read ON hr_employee_surveys
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_employee_surveys_write ON hr_employee_surveys;
CREATE POLICY hr_employee_surveys_write ON hr_employee_surveys
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
  -- Disciplinary
  IF NOT EXISTS (SELECT 1 FROM hr_disciplinary_actions WHERE property_id = v_main AND employee = 'John Doe') THEN
    INSERT INTO hr_disciplinary_actions (property_id, employee, action_type, category, action_date, issued_by, description, status, expiry_date)
    VALUES
      (v_main, 'John Doe',       'Written Warning', 'Attendance',  '2024-06-20', 'Sarah Johnson',  'Repeated tardiness - 3 late arrivals in June',             'Active',   '2024-12-20'),
      (v_main, 'Elena Smith',    'Verbal Warning',  'Performance', '2024-06-15', 'Sarah Johnson',  'Below performance standards for guest satisfaction',        'Active',   '2024-09-15'),
      (v_main, 'Carlos Ray',     'Suspension',      'Conduct',     '2024-05-10', 'Robert Wilson',  'Violation of safety protocols',                            'Resolved', '2024-05-17');
  END IF;

  -- Grievances
  IF NOT EXISTS (SELECT 1 FROM hr_grievances WHERE property_id = v_main AND employee = 'Maria Garcia') THEN
    INSERT INTO hr_grievances (property_id, employee, type, category, grievance_date, description, status, assigned_to, priority)
    VALUES
      (v_main, 'Maria Garcia',  'Working Conditions', 'Facilities',         '2024-06-18', 'Inadequate break room facilities',                         'Under Investigation', 'HR Department',  'Medium'),
      (v_main, 'James Wilson',  'Harassment',         'Workplace Relations', '2024-06-10', 'Report of inappropriate behavior by supervisor',          'Investigation Complete','HR Director',   'High'),
      (v_main, 'Lisa Anderson', 'Pay Dispute',        'Compensation',        '2024-05-25', 'Discrepancy in overtime calculation',                     'Resolved',            'Payroll Manager', 'Low');
  END IF;

  -- Recognition programs
  IF NOT EXISTS (SELECT 1 FROM hr_recognition_programs WHERE property_id = v_main AND name = 'Employee of the Month') THEN
    INSERT INTO hr_recognition_programs (property_id, name, program_type, description, current_winner, last_awarded, next_nomination, status)
    VALUES
      (v_main, 'Employee of the Month', 'Monthly',     'Recognizes outstanding performance and dedication', 'Sarah Johnson',   '2024-06-01', '2024-07-01', 'Active'),
      (v_main, 'Service Award',         'Longevity',   'Celebrates years of service milestones',            'Multiple recipients','2024-06-15', 'Ongoing',    'Active'),
      (v_main, 'Innovation Award',      'Quarterly',   'Rewards creative solutions and process improvements', 'Engineering Team', '2024-04-01', '2024-07-01', 'Active');
  END IF;

  -- Recent recognition
  IF NOT EXISTS (SELECT 1 FROM hr_recent_recognition WHERE property_id = v_main AND employee = 'Sarah Johnson') THEN
    INSERT INTO hr_recent_recognition (property_id, employee, award, category, award_date, recognized_by, reason)
    VALUES
      (v_main, 'Sarah Johnson', 'Employee of the Month', 'Performance',  '2024-06-01', 'General Manager',    'Exceptional guest satisfaction scores and team leadership'),
      (v_main, 'Robert Wilson', '5 Years Service',       'Longevity',    '2024-05-20', 'General Manager',    'Dedicated service and commitment to excellence'),
      (v_main, 'Elena Martinez','Innovation Award',      'Innovation',   '2024-04-01', 'Operations Director','Developed new kitchen efficiency protocols');
  END IF;

  -- Surveys
  IF NOT EXISTS (SELECT 1 FROM hr_employee_surveys WHERE property_id = v_main AND name = 'Employee Satisfaction Survey') THEN
    INSERT INTO hr_employee_surveys (property_id, name, survey_type, survey_date, response_rate, participants, status, overall_score)
    VALUES
      (v_main, 'Employee Satisfaction Survey', 'Annual',    '2024-03-15', 78, 193, 'Completed',   4.2),
      (v_main, 'Work Environment Feedback',    'Quarterly', '2024-06-01', 65, 161, 'In Progress', NULL),
      (v_main, 'Training Needs Assessment',    'Biennial',  '2023-11-20', 82, 203, 'Completed',   4.0);
  END IF;
END $$;
