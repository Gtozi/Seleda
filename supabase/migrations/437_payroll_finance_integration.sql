-- HR / Finance Payroll Integration
-- ============================================================================
-- payroll_account_mapping
-- ============================================================================
CREATE TABLE IF NOT EXISTS payroll_account_mapping (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  line_type       TEXT NOT NULL UNIQUE,
  account_code    TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_account_mapping_property ON payroll_account_mapping(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS payroll_account_mapping_updated_at ON payroll_account_mapping;
CREATE TRIGGER payroll_account_mapping_updated_at
  BEFORE UPDATE ON payroll_account_mapping
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_account_mapping TO authenticated;

ALTER TABLE payroll_account_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_account_mapping_read ON payroll_account_mapping;
CREATE POLICY payroll_account_mapping_read ON payroll_account_mapping
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS payroll_account_mapping_write ON payroll_account_mapping;
CREATE POLICY payroll_account_mapping_write ON payroll_account_mapping
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed default chart of accounts and mapping for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Payroll expense and liability accounts
  INSERT INTO chart_of_accounts (property_id, code, name, category, sub_category, is_active, currency)
  VALUES
    (v_main, '6100', 'Payroll Expense',           'Expense',   'Payroll',         TRUE, 'ETB'),
    (v_main, '6110', 'Pension Expense',           'Expense',   'Payroll',         TRUE, 'ETB'),
    (v_main, '2200', 'Tax Payable',               'Liability', 'Payroll',         TRUE, 'ETB'),
    (v_main, '2310', 'Pension Payable',           'Liability', 'Payroll',         TRUE, 'ETB'),
    (v_main, '2320', 'Wages Payable',             'Liability', 'Payroll',         TRUE, 'ETB'),
    (v_main, '2330', 'Loan Deductions Payable',   'Liability', 'Payroll',         TRUE, 'ETB')
  ON CONFLICT (property_id, code) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM payroll_account_mapping WHERE property_id = v_main) THEN
    INSERT INTO payroll_account_mapping (property_id, line_type, account_code, account_name)
    VALUES
      (v_main, 'gross_pay',            '6100', 'Payroll Expense'),
      (v_main, 'pension_employer',     '6110', 'Pension Expense'),
      (v_main, 'income_tax',           '2200', 'Tax Payable'),
      (v_main, 'pension_employee',     '2310', 'Pension Payable'),
      (v_main, 'pension_employer_liability', '2310', 'Pension Payable'),
      (v_main, 'net_pay',              '2320', 'Wages Payable'),
      (v_main, 'loan_deduction',       '2330', 'Loan Deductions Payable'),
      (v_main, 'other_deductions',     '2320', 'Wages Payable');
  END IF;
END $$;
