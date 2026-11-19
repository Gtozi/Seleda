-- Payroll Inputs Integration
-- Wires the payroll engine to its input sources:
--   * hr_employee_loans      — employee loan / salary-advance tracking so
--                              monthly installments can be deducted on payslips
--   * payslips.calc_details  — JSONB breakdown of the inputs used per payslip
--                              (unpaid leave days, absent days, overtime hours,
--                              loan installments) for auditability and to drive
--                              loan balance updates when a run is Posted.
--
-- Existing input tables reused (no schema change needed):
--   hr_leave_requests    — approved 'Unpaid' leave days overlap the period
--   staff_attendance     — 'Absent' days inside the period
--   hr_overtime_requests — approved overtime hours + rate multiplier
--   hr_configuration     — 'payroll' / 'Deduction Rules' toggles

-- ============================================================================
-- hr_employee_loans
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_employee_loans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL,
  employee_name       TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'Loan'
                        CHECK (type IN ('Loan', 'Salary Advance')),
  principal           NUMERIC NOT NULL CHECK (principal >= 0),
  monthly_installment NUMERIC NOT NULL CHECK (monthly_installment > 0),
  balance_remaining   NUMERIC NOT NULL CHECK (balance_remaining >= 0),
  start_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  status              TEXT NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Active', 'Completed', 'Suspended')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_property ON hr_employee_loans(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_employee ON hr_employee_loans(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_loans_status   ON hr_employee_loans(property_id, status)
  WHERE status = 'Active';

-- ============================================================================
-- payslips.calc_details — transparent input breakdown per payslip
-- Shape: { unpaidLeaveDays, absentDays, unpaidDays, overtimeHours,
--          loans: [{ loanId, amount }] }
-- ============================================================================
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS calc_details JSONB;

-- ============================================================================
-- Trigger (reuse the shared updated_at function from migration 412)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_employee_loans_updated_at ON hr_employee_loans;
CREATE TRIGGER hr_employee_loans_updated_at
  BEFORE UPDATE ON hr_employee_loans
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS (same pattern as sibling HR migrations)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employee_loans TO authenticated;

ALTER TABLE hr_employee_loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_employee_loans_read ON hr_employee_loans;
CREATE POLICY hr_employee_loans_read ON hr_employee_loans
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_employee_loans_write ON hr_employee_loans;
CREATE POLICY hr_employee_loans_write ON hr_employee_loans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));
