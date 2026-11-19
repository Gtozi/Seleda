-- HR Time & Overtime
-- Supports overtime requests, time-off-in-lieu (TOIL) balances, monthly
-- overtime history, and per-department labor cost analysis.

-- ============================================================================
-- hr_overtime_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_overtime_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  department      TEXT NOT NULL,
  type            TEXT NOT NULL,
  overtime_date   DATE NOT NULL,
  start_time      TEXT,
  end_time        TEXT,
  hours           NUMERIC NOT NULL,
  rate            TEXT NOT NULL DEFAULT '1.5x',
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_overtime_requests_property ON hr_overtime_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_overtime_requests_status   ON hr_overtime_requests(property_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_overtime_requests_date     ON hr_overtime_requests(property_id, overtime_date);

-- ============================================================================
-- hr_toil_records
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_toil_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  department      TEXT NOT NULL,
  hours_earned    NUMERIC NOT NULL DEFAULT 0,
  hours_used      NUMERIC NOT NULL DEFAULT 0,
  balance         NUMERIC GENERATED ALWAYS AS (hours_earned - hours_used) STORED,
  expiry_date     DATE,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Exhausted', 'Expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_toil_records_property ON hr_toil_records(property_id);

-- ============================================================================
-- hr_overtime_history
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_overtime_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,
  total_hours     NUMERIC NOT NULL DEFAULT 0,
  total_cost      NUMERIC NOT NULL DEFAULT 0,
  approvals       INTEGER NOT NULL DEFAULT 0,
  rejections      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_overtime_history_property ON hr_overtime_history(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_overtime_history_period ON hr_overtime_history(property_id, period);

-- ============================================================================
-- hr_labor_cost_analysis
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_labor_cost_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  department      TEXT NOT NULL,
  period          TEXT NOT NULL,
  budget          NUMERIC NOT NULL DEFAULT 0,
  actual          NUMERIC NOT NULL DEFAULT 0,
  overtime_hours  NUMERIC NOT NULL DEFAULT 0,
  overtime_cost   NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_labor_cost_analysis_property ON hr_labor_cost_analysis(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_labor_cost_analysis_dept_period ON hr_labor_cost_analysis(property_id, department, period);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_overtime_requests_updated_at ON hr_overtime_requests;
CREATE TRIGGER hr_overtime_requests_updated_at
  BEFORE UPDATE ON hr_overtime_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_toil_records_updated_at ON hr_toil_records;
CREATE TRIGGER hr_toil_records_updated_at
  BEFORE UPDATE ON hr_toil_records
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_overtime_history_updated_at ON hr_overtime_history;
CREATE TRIGGER hr_overtime_history_updated_at
  BEFORE UPDATE ON hr_overtime_history
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_labor_cost_analysis_updated_at ON hr_labor_cost_analysis;
CREATE TRIGGER hr_labor_cost_analysis_updated_at
  BEFORE UPDATE ON hr_labor_cost_analysis
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_overtime_requests    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_toil_records         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_overtime_history     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_labor_cost_analysis  TO authenticated;

ALTER TABLE hr_overtime_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_toil_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_overtime_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_labor_cost_analysis  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_overtime_requests_read ON hr_overtime_requests;
CREATE POLICY hr_overtime_requests_read ON hr_overtime_requests
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_overtime_requests_write ON hr_overtime_requests;
CREATE POLICY hr_overtime_requests_write ON hr_overtime_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_toil_records_read ON hr_toil_records;
CREATE POLICY hr_toil_records_read ON hr_toil_records
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_toil_records_write ON hr_toil_records;
CREATE POLICY hr_toil_records_write ON hr_toil_records
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_overtime_history_read ON hr_overtime_history;
CREATE POLICY hr_overtime_history_read ON hr_overtime_history
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_overtime_history_write ON hr_overtime_history;
CREATE POLICY hr_overtime_history_write ON hr_overtime_history
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_labor_cost_analysis_read ON hr_labor_cost_analysis;
CREATE POLICY hr_labor_cost_analysis_read ON hr_labor_cost_analysis
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_labor_cost_analysis_write ON hr_labor_cost_analysis;
CREATE POLICY hr_labor_cost_analysis_write ON hr_labor_cost_analysis
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
  -- Overtime requests
  IF NOT EXISTS (SELECT 1 FROM hr_overtime_requests WHERE property_id = v_main AND employee_name = 'John Doe') THEN
    INSERT INTO hr_overtime_requests (property_id, employee_id, employee_name, department, type, overtime_date, start_time, end_time, hours, rate, reason, status)
    VALUES
      (v_main, 'EMP-FO-01', 'John Doe',     'Front Office', 'Weekend Work',    '2024-06-29', '08:00', '16:00', 8, '1.5x', 'Special event coverage',   'Pending'),
      (v_main, 'EMP-FO-02', 'Elena Smith',  'Front Office', 'Holiday Work',    '2024-07-04', '07:00', '15:00', 8, '2.0x', 'Independence Day',         'Approved'),
      (v_main, 'EMP-FO-03', 'Carlos Ray',   'Front Office', 'Regular Overtime','2024-06-28', '16:00', '20:00', 4, '1.5x', 'Late checkout assistance', 'Pending');
  END IF;

  -- TOIL records
  IF NOT EXISTS (SELECT 1 FROM hr_toil_records WHERE property_id = v_main AND employee_name = 'Maria Garcia') THEN
    INSERT INTO hr_toil_records (property_id, employee_id, employee_name, department, hours_earned, hours_used, expiry_date, status)
    VALUES
      (v_main, 'EMP-FO-04', 'Maria Garcia', 'Front Office', 8, 0, '2024-12-31', 'Active'),
      (v_main, 'EMP-FO-01', 'John Doe',     'Front Office', 4, 4, '2024-09-30', 'Exhausted');
  END IF;

  -- Monthly overtime history
  IF NOT EXISTS (SELECT 1 FROM hr_overtime_history WHERE property_id = v_main AND period = 'June 2024') THEN
    INSERT INTO hr_overtime_history (property_id, period, total_hours, total_cost, approvals, rejections)
    VALUES
      (v_main, 'June 2024',   142, 8520, 38, 3),
      (v_main, 'May 2024',    128, 7680, 35, 2),
      (v_main, 'April 2024',  115, 6900, 32, 4),
      (v_main, 'March 2024',   98, 5880, 28, 1);
  END IF;

  -- Labor cost analysis for current month
  IF NOT EXISTS (SELECT 1 FROM hr_labor_cost_analysis WHERE property_id = v_main AND department = 'Front Office' AND period = 'June 2024') THEN
    INSERT INTO hr_labor_cost_analysis (property_id, department, period, budget, actual, overtime_hours, overtime_cost)
    VALUES
      (v_main, 'Front Office',  'June 2024', 45000, 48200, 45, 2700),
      (v_main, 'Housekeeping',  'June 2024', 38000, 37500, 32, 1920),
      (v_main, 'Food & Beverage','June 2024', 52000, 54800, 58, 3480),
      (v_main, 'Engineering',   'June 2024', 28000, 27500, 18, 1080);
  END IF;
END $$;
