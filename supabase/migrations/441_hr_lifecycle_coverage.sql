-- HR Coverage Gaps: Offboarding, Leave Accrual, Contract-Expiry
-- Adds the missing lifecycle infrastructure that the HR portal lacks:
--   * employees.contract_end_date + termination columns — for contract-expiry
--     alerting and structured offboarding
--   * hr_offboarding_cases — exit clearance workflow (clearance checklist,
--     final settlement, exit interview)
--   * hr_leave_accrual_rules — automated accrual rates per leave type +
--     employment type, with carry-forward policy
--   * hr_leave_accrual_log — monthly accrual run audit trail (so the
--     leave accrual engine is reproducible and auditable)

-- ============================================================================
-- employees: contract + termination columns
-- ============================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_start_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_reason TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS terminated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_contract_end ON employees(property_id, contract_end_date)
  WHERE contract_end_date IS NOT NULL AND status = 'Active';
CREATE INDEX IF NOT EXISTS idx_employees_termination ON employees(property_id, termination_date)
  WHERE termination_date IS NOT NULL;

-- ============================================================================
-- hr_offboarding_cases
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_offboarding_cases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL,
  employee_name       TEXT NOT NULL,
  department          TEXT,
  position            TEXT,
  termination_date    DATE NOT NULL,
  reason              TEXT NOT NULL DEFAULT 'Resignation'
                        CHECK (reason IN ('Resignation', 'Termination', 'Retirement', 'Contract End', 'Dismissal', 'Other')),
  clearance_status    TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (clearance_status IN ('Pending', 'In Progress', 'Completed')),
  final_settlement    NUMERIC NOT NULL DEFAULT 0,
  settlement_paid     BOOLEAN NOT NULL DEFAULT FALSE,
  exit_interview      BOOLEAN NOT NULL DEFAULT FALSE,
  exit_interview_notes TEXT,
  checklist           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'Open'
                        CHECK (status IN ('Open', 'Completed', 'Cancelled')),
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_offboarding_property ON hr_offboarding_cases(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_offboarding_employee ON hr_offboarding_cases(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_offboarding_status   ON hr_offboarding_cases(property_id, status)
  WHERE status = 'Open';

-- ============================================================================
-- hr_leave_accrual_rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_leave_accrual_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  leave_type          TEXT NOT NULL,
  employment_type      TEXT NOT NULL DEFAULT 'Full-time'
                        CHECK (employment_type IN ('Full-time', 'Part-time', 'Contract', 'All')),
  monthly_accrual_days NUMERIC NOT NULL DEFAULT 0,
  max_carry_forward   NUMERIC NOT NULL DEFAULT 0,
  encashable          BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_leave_accrual_rule
  ON hr_leave_accrual_rules(property_id, leave_type, employment_type);
CREATE INDEX IF NOT EXISTS idx_hr_leave_accrual_property ON hr_leave_accrual_rules(property_id)
  WHERE is_active = TRUE;

-- ============================================================================
-- hr_leave_accrual_log — audit trail for accrual runs
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_leave_accrual_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  period              TEXT NOT NULL,
  employee_id         TEXT NOT NULL,
  leave_type          TEXT NOT NULL,
  days_accrued        NUMERIC NOT NULL,
  balance_before      NUMERIC NOT NULL,
  balance_after       NUMERIC NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_accrual_log_property ON hr_leave_accrual_log(property_id, period);
CREATE INDEX IF NOT EXISTS idx_hr_leave_accrual_log_employee ON hr_leave_accrual_log(employee_id);

-- ============================================================================
-- Triggers (reuse the shared updated_at function)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_offboarding_cases_updated_at ON hr_offboarding_cases;
CREATE TRIGGER hr_offboarding_cases_updated_at
  BEFORE UPDATE ON hr_offboarding_cases
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_leave_accrual_rules_updated_at ON hr_leave_accrual_rules;
CREATE TRIGGER hr_leave_accrual_rules_updated_at
  BEFORE UPDATE ON hr_leave_accrual_rules
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_offboarding_cases   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_accrual_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_accrual_log   TO authenticated;

ALTER TABLE hr_offboarding_cases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_accrual_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_accrual_log    ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (same pattern as sibling HR tables)
DROP POLICY IF EXISTS hr_offboarding_cases_read ON hr_offboarding_cases;
CREATE POLICY hr_offboarding_cases_read ON hr_offboarding_cases
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_leave_accrual_rules_read ON hr_leave_accrual_rules;
CREATE POLICY hr_leave_accrual_rules_read ON hr_leave_accrual_rules
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_leave_accrual_log_read ON hr_leave_accrual_log;
CREATE POLICY hr_leave_accrual_log_read ON hr_leave_accrual_log
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins
DROP POLICY IF EXISTS hr_offboarding_cases_write ON hr_offboarding_cases;
CREATE POLICY hr_offboarding_cases_write ON hr_offboarding_cases
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_leave_accrual_rules_write ON hr_leave_accrual_rules;
CREATE POLICY hr_leave_accrual_rules_write ON hr_leave_accrual_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_leave_accrual_log_write ON hr_leave_accrual_log;
CREATE POLICY hr_leave_accrual_log_write ON hr_leave_accrual_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed default accrual rules for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hr_leave_accrual_rules WHERE property_id = v_main) THEN
    INSERT INTO hr_leave_accrual_rules (property_id, leave_type, employment_type, monthly_accrual_days, max_carry_forward, encashable)
    VALUES
      (v_main, 'Annual Leave',    'Full-time', 1.75, 5,  TRUE),
      (v_main, 'Annual Leave',    'Part-time', 1.00, 3,  TRUE),
      (v_main, 'Sick Leave',      'All',       0.83, 0,  FALSE),
      (v_main, 'Emergency Leave', 'All',       0.42, 0,  FALSE);
  END IF;
END $$;
