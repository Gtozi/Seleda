-- HR Manager Self-Service (MSS)
-- Manager approval queue, team roster, performance reviews, and recruitment
-- requests for the HR > MSS module.
--
-- Tables created here:
--   hr_manager_approvals    — unified approval queue (Leave, Overtime, Expense, Training)
--   hr_team_roster          — team schedule / shift assignments
--   hr_performance_reviews  — quarterly performance reviews with goals
--   hr_recruitment_requests — manager headcount/replacement requests

-- ============================================================================
-- hr_manager_approvals
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_manager_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  type            TEXT NOT NULL
                    CHECK (type IN ('Leave', 'Overtime', 'Expense', 'Training')),
  details         TEXT NOT NULL,
  request_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  priority        TEXT NOT NULL DEFAULT 'Normal'
                    CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_manager_approvals_property ON hr_manager_approvals(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_manager_approvals_status  ON hr_manager_approvals(status);
CREATE INDEX IF NOT EXISTS idx_hr_manager_approvals_priority ON hr_manager_approvals(priority);

-- ============================================================================
-- hr_team_roster
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_team_roster (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  department      TEXT NOT NULL,
  roster_date     DATE NOT NULL,
  shift           TEXT NOT NULL DEFAULT 'Morning'
                    CHECK (shift IN ('Morning', 'Evening', 'Night', 'Off')),
  role            TEXT NOT NULL DEFAULT '-',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_team_roster_property_date ON hr_team_roster(property_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_hr_team_roster_employee ON hr_team_roster(employee_id);

-- ============================================================================
-- hr_performance_reviews
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_performance_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  period          TEXT NOT NULL,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'In Progress', 'Completed')),
  goals           INTEGER NOT NULL DEFAULT 5,
  completed       INTEGER NOT NULL DEFAULT 0,
  reviewer        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_performance_reviews_property ON hr_performance_reviews(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_performance_reviews_status  ON hr_performance_reviews(status);

-- ============================================================================
-- hr_recruitment_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_recruitment_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  position        TEXT NOT NULL,
  department      TEXT NOT NULL,
  request_type    TEXT NOT NULL DEFAULT 'New Position'
                    CHECK (request_type IN ('New Position', 'Replacement', 'Expansion')),
  priority        TEXT NOT NULL DEFAULT 'Normal'
                    CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Filled')),
  vacancies       INTEGER NOT NULL DEFAULT 1,
  requested_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_recruitment_requests_property ON hr_recruitment_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_recruitment_requests_status  ON hr_recruitment_requests(status);

-- ============================================================================
-- updated_at triggers (reuse the function from migration 412)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_manager_approvals_updated_at ON hr_manager_approvals;
CREATE TRIGGER hr_manager_approvals_updated_at
  BEFORE UPDATE ON hr_manager_approvals
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_team_roster_updated_at ON hr_team_roster;
CREATE TRIGGER hr_team_roster_updated_at
  BEFORE UPDATE ON hr_team_roster
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_performance_reviews_updated_at ON hr_performance_reviews;
CREATE TRIGGER hr_performance_reviews_updated_at
  BEFORE UPDATE ON hr_performance_reviews
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_recruitment_requests_updated_at ON hr_recruitment_requests;
CREATE TRIGGER hr_recruitment_requests_updated_at
  BEFORE UPDATE ON hr_recruitment_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_manager_approvals    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_team_roster          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_performance_reviews  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_recruitment_requests TO authenticated;

ALTER TABLE hr_manager_approvals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_team_roster          ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_performance_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_recruitment_requests ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user.
DROP POLICY IF EXISTS hr_manager_approvals_read ON hr_manager_approvals;
CREATE POLICY hr_manager_approvals_read ON hr_manager_approvals
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_team_roster_read ON hr_team_roster;
CREATE POLICY hr_team_roster_read ON hr_team_roster
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_performance_reviews_read ON hr_performance_reviews;
CREATE POLICY hr_performance_reviews_read ON hr_performance_reviews
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_recruitment_requests_read ON hr_recruitment_requests;
CREATE POLICY hr_recruitment_requests_read ON hr_recruitment_requests
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins.
DROP POLICY IF EXISTS hr_manager_approvals_write ON hr_manager_approvals;
CREATE POLICY hr_manager_approvals_write ON hr_manager_approvals
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_team_roster_write ON hr_team_roster;
CREATE POLICY hr_team_roster_write ON hr_team_roster
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_performance_reviews_write ON hr_performance_reviews;
CREATE POLICY hr_performance_reviews_write ON hr_performance_reviews
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_recruitment_requests_write ON hr_recruitment_requests;
CREATE POLICY hr_recruitment_requests_write ON hr_recruitment_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Mock data seed — Gheralta Main Property (GH-MAIN)
-- Mirrors the placeholder data in ManagerSelfService.tsx.
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF EXISTS (SELECT 1 FROM hr_manager_approvals WHERE property_id = v_main_property AND employee_name = 'John Doe') THEN
    RETURN;
  END IF;

  -- Manager approval queue
  INSERT INTO hr_manager_approvals (property_id, employee_id, employee_name, type, details, request_date, priority, status)
  VALUES
    (v_main_property, 'EMP-FO-01', 'John Doe',      'Leave',    'Annual Leave: Jun 05 - Jun 12 (7 days)',            '2024-06-01', 'Normal', 'Pending'),
    (v_main_property, 'EMP-FO-02', 'Elena Smith',   'Overtime', 'Weekend Work: 8 hours on May 31',                   '2024-05-31', 'High',   'Pending'),
    (v_main_property, 'EMP-FO-03', 'Carlos Ray',    'Expense',  'Travel Expense: $150 for client meeting',           '2024-05-30', 'Normal', 'Pending'),
    (v_main_property, 'EMP-FO-04', 'Maria Garcia',  'Training', 'Leadership Course: July 10-12',                     '2024-05-29', 'Normal', 'Pending');

  -- Team roster (Friday Jun 28 to Sunday Jun 30)
  INSERT INTO hr_team_roster (property_id, employee_id, employee_name, department, roster_date, shift, role)
  VALUES
    (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-28', 'Morning', 'Reception'),
    (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-28', 'Evening', 'Reception'),
    (v_main_property, 'EMP-FO-04', 'Maria Garcia', 'Front Office', '2024-06-28', 'Morning', 'Bell Services'),
    (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-29', 'Morning', 'Reception'),
    (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-29', 'Evening', 'Reception'),
    (v_main_property, 'EMP-FO-04', 'Maria Garcia', 'Front Office', '2024-06-29', 'Off',     '-'),
    (v_main_property, 'EMP-FO-01', 'John Doe',     'Front Office', '2024-06-30', 'Off',     '-'),
    (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Front Office', '2024-06-30', 'Morning', 'Reception'),
    (v_main_property, 'EMP-FO-04', 'Maria Garcia', 'Front Office', '2024-06-30', 'Evening', 'Bell Services');

  -- Performance reviews
  INSERT INTO hr_performance_reviews (property_id, employee_id, employee_name, period, due_date, status, goals, completed, reviewer)
  VALUES
    (v_main_property, 'EMP-FO-01', 'John Doe',     'Q2 2024', '2024-06-30', 'In Progress', 5, 3, 'Sarah Johnson'),
    (v_main_property, 'EMP-FO-02', 'Elena Smith',  'Q2 2024', '2024-06-30', 'Pending',     5, 0, 'Sarah Johnson'),
    (v_main_property, 'EMP-FO-03', 'Carlos Ray',   'Q2 2024', '2024-06-15', 'Completed',   5, 5, 'Sarah Johnson');

  -- Recruitment requests
  INSERT INTO hr_recruitment_requests (property_id, position, department, request_type, priority, status, vacancies, requested_by)
  VALUES
    (v_main_property, 'Receptionist', 'Front Office', 'Replacement',  'High',   'Approved', 2, 'Sarah Johnson'),
    (v_main_property, 'Concierge',    'Front Office', 'New Position', 'Normal', 'Pending',  1, 'Sarah Johnson');
END $$;
