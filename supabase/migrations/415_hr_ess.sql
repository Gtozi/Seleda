-- HR Employee Self-Service (ESS)
-- Leave balances, leave requests, training requests, and company documents
-- for the HR > ESS module. The placeholder EmployeeSelfService.tsx also
-- renders payslips, attendance, and expense claims — those already have
-- dedicated tables (payslips, staff_attendance, expense_claims) and are
-- reused via the ESS API. The employee profile is sourced from the
-- employees table (migration 411).
--
-- Tables created here:
--   hr_leave_balances   — per-employee leave entitlements and usage
--   hr_leave_requests    — leave requests submitted by employees
--   hr_training_requests — training/course requests submitted by employees
--   hr_company_documents — company-wide documents visible to employees

-- ============================================================================
-- hr_leave_balances
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_leave_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  leave_type      TEXT NOT NULL,
  total_days      NUMERIC NOT NULL DEFAULT 0,
  used_days       NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_balances_property ON hr_leave_balances(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_balances_employee ON hr_leave_balances(employee_id);

-- ============================================================================
-- hr_leave_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  leave_type      TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  days            NUMERIC NOT NULL DEFAULT 1,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_property ON hr_leave_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_employee ON hr_leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_status ON hr_leave_requests(status);

-- ============================================================================
-- hr_training_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_training_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  course          TEXT NOT NULL,
  start_date      DATE,
  end_date        DATE,
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_training_requests_property ON hr_training_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_training_requests_employee ON hr_training_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_training_requests_status ON hr_training_requests(status);

-- ============================================================================
-- hr_company_documents
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_company_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  document_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Current', 'Valid', 'Expired', 'Archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_company_documents_property ON hr_company_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_company_documents_type ON hr_company_documents(type);

-- ============================================================================
-- updated_at triggers (reuse the function from migration 412)
-- ============================================================================
DROP TRIGGER IF EXISTS hr_leave_balances_updated_at ON hr_leave_balances;
CREATE TRIGGER hr_leave_balances_updated_at
  BEFORE UPDATE ON hr_leave_balances
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_leave_requests_updated_at ON hr_leave_requests;
CREATE TRIGGER hr_leave_requests_updated_at
  BEFORE UPDATE ON hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_training_requests_updated_at ON hr_training_requests;
CREATE TRIGGER hr_training_requests_updated_at
  BEFORE UPDATE ON hr_training_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_company_documents_updated_at ON hr_company_documents;
CREATE TRIGGER hr_company_documents_updated_at
  BEFORE UPDATE ON hr_company_documents
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_balances    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_requests     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_training_requests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_company_documents  TO authenticated;

ALTER TABLE hr_leave_balances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_training_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_company_documents ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user.
DROP POLICY IF EXISTS hr_leave_balances_read ON hr_leave_balances;
CREATE POLICY hr_leave_balances_read ON hr_leave_balances
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_leave_requests_read ON hr_leave_requests;
CREATE POLICY hr_leave_requests_read ON hr_leave_requests
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_training_requests_read ON hr_training_requests;
CREATE POLICY hr_training_requests_read ON hr_training_requests
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_company_documents_read ON hr_company_documents;
CREATE POLICY hr_company_documents_read ON hr_company_documents
  FOR SELECT TO authenticated USING (TRUE);

-- Write: admins.
DROP POLICY IF EXISTS hr_leave_balances_write ON hr_leave_balances;
CREATE POLICY hr_leave_balances_write ON hr_leave_balances
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_leave_requests_write ON hr_leave_requests;
CREATE POLICY hr_leave_requests_write ON hr_leave_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_training_requests_write ON hr_training_requests;
CREATE POLICY hr_training_requests_write ON hr_training_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_company_documents_write ON hr_company_documents;
CREATE POLICY hr_company_documents_write ON hr_company_documents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Mock data seed — Gheralta Main Property (GH-MAIN)
-- Uses Sarah Johnson (Front Office Manager) as the demo ESS user, mirroring
-- the placeholder data in EmployeeSelfService.tsx.
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_sarah_id TEXT := 'EMP-FO-MGR';
BEGIN
  IF EXISTS (SELECT 1 FROM hr_leave_balances WHERE property_id = v_main_property AND employee_id = v_sarah_id) THEN
    RETURN;
  END IF;

  -- Leave balances for Sarah Johnson
  INSERT INTO hr_leave_balances (property_id, employee_id, employee_name, leave_type, total_days, used_days)
  VALUES
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Annual Leave', 21, 7),
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Sick Leave', 10, 2),
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Emergency Leave', 5, 1),
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Compensatory', 0, 0);

  -- Leave requests for Sarah Johnson
  INSERT INTO hr_leave_requests (property_id, employee_id, employee_name, leave_type, start_date, end_date, days, reason, status)
  VALUES
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Annual', '2024-06-05', '2024-06-12', 7, 'Family vacation', 'Pending'),
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Sick', '2024-05-15', '2024-05-15', 1, 'Medical appointment', 'Approved');

  -- Training requests for Sarah Johnson
  INSERT INTO hr_training_requests (property_id, employee_id, employee_name, course, start_date, end_date, status)
  VALUES
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Leadership Excellence', '2024-07-10', '2024-07-12', 'Approved'),
    (v_main_property, v_sarah_id, 'Sarah Johnson', 'Advanced Customer Service', '2024-08-05', '2024-08-05', 'Pending');

  -- Company documents (visible to all employees of the property)
  INSERT INTO hr_company_documents (property_id, name, type, document_date, status)
  VALUES
    (v_main_property, 'Employment Contract', 'Contract', '2021-03-12', 'Active'),
    (v_main_property, 'Employee Handbook 2024', 'Policy', '2024-01-01', 'Current'),
    (v_main_property, 'Non-Disclosure Agreement', 'NDA', '2021-03-12', 'Active'),
    (v_main_property, 'Safety Training Certificate', 'Certificate', '2023-11-20', 'Valid');

  -- Payslips for Sarah Johnson (reuses existing payslips table)
  INSERT INTO payslips (id, property_id, employee_id, period, basic_salary, allowances, overtime, gross_pay, income_tax, pension_employee, total_deductions, net_pay, status, paid_at)
  VALUES
    ('PSL-ESS-001', v_main_property, v_sarah_id, 'June 2024',  5000, 850, 0, 5850, 1100, 350, 1650, 4200, 'Paid', '2024-06-28T00:00:00Z'),
    ('PSL-ESS-002', v_main_property, v_sarah_id, 'May 2024',  5000, 850, 0, 5850, 1100, 350, 1650, 4200, 'Paid', '2024-05-28T00:00:00Z'),
    ('PSL-ESS-003', v_main_property, v_sarah_id, 'April 2024', 5000, 850, 0, 5850, 1100, 350, 1650, 4200, 'Paid', '2024-04-28T00:00:00Z'),
    ('PSL-ESS-004', v_main_property, v_sarah_id, 'March 2024', 5000, 850, 0, 5850, 1100, 350, 1650, 4200, 'Paid', '2024-03-28T00:00:00Z');

  -- Expense claims for Sarah Johnson (reuses existing expense_claims table)
  -- NOTE: expense_claims.status check constraint requires lowercase values.
  INSERT INTO expense_claims (id, property_id, employee_id, employee_name, amount, category, description, status, submitted_date)
  VALUES
    ('EXP-ESS-001', v_main_property, v_sarah_id, 'Sarah Johnson', 150, 'Travel', 'Client meeting travel', 'approved', '2024-06-20'),
    ('EXP-ESS-002', v_main_property, v_sarah_id, 'Sarah Johnson', 85,  'Meals', 'Business lunch with suppliers', 'pending', '2024-06-18');

  -- Attendance records for Sarah Johnson (reuses existing staff_attendance table)
  INSERT INTO staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, check_in, check_out, status, hours_worked, employee_id)
  VALUES
    ('ATT-ESS-001', v_main_property, v_sarah_id, 'Sarah Johnson', 'FO', '2024-06-28', 'Morning', '2024-06-28T07:52:00Z', '2024-06-28T16:15:00Z', 'Present', 8.4, v_sarah_id),
    ('ATT-ESS-002', v_main_property, v_sarah_id, 'Sarah Johnson', 'FO', '2024-06-27', 'Morning', '2024-06-27T07:48:00Z', '2024-06-27T16:10:00Z', 'Present', 8.4, v_sarah_id),
    ('ATT-ESS-003', v_main_property, v_sarah_id, 'Sarah Johnson', 'FO', '2024-06-26', 'Morning', '2024-06-26T08:05:00Z', '2024-06-26T16:20:00Z', 'Late',    8.3, v_sarah_id),
    ('ATT-ESS-004', v_main_property, v_sarah_id, 'Sarah Johnson', 'FO', '2024-06-25', 'Morning', NULL, NULL, 'Absent', 0, v_sarah_id);
END $$;
