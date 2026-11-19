-- HR Configuration
-- Generic key/value settings grouped by configuration domain.

-- ============================================================================
-- hr_configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_configuration (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  config_group    TEXT NOT NULL CHECK (config_group IN ('organization', 'attendance', 'payroll', 'performance')),
  category        TEXT NOT NULL,
  setting_name    TEXT NOT NULL,
  setting_value   TEXT NOT NULL,
  setting_type    TEXT NOT NULL DEFAULT 'text' CHECK (setting_type IN ('text', 'number', 'boolean', 'select')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_configuration_property ON hr_configuration(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_configuration_group ON hr_configuration(config_group);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_configuration_updated_at ON hr_configuration;
CREATE TRIGGER hr_configuration_updated_at
  BEFORE UPDATE ON hr_configuration
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_configuration TO authenticated;

ALTER TABLE hr_configuration ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_configuration_read ON hr_configuration;
CREATE POLICY hr_configuration_read ON hr_configuration
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_configuration_write ON hr_configuration;
CREATE POLICY hr_configuration_write ON hr_configuration
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
  IF NOT EXISTS (SELECT 1 FROM hr_configuration WHERE property_id = v_main) THEN
    INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
    VALUES
      -- Organization
      (v_main, 'organization', 'Organization Structure', 'Company Name',              'Master Hotel Group',           'text',    1),
      (v_main, 'organization', 'Organization Structure', 'Default Department',        'Front Office',                 'select',  2),
      (v_main, 'organization', 'Organization Structure', 'Default Location',          'New York, USA',                'text',    3),
      (v_main, 'organization', 'Departments',            'Total Departments',         '8',                            'number',  1),
      (v_main, 'organization', 'Departments',            'Auto-create Cost Centers',  'Yes',                          'boolean', 2),
      (v_main, 'organization', 'Departments',            'Department Head Required',  'Yes',                          'boolean', 3),
      (v_main, 'organization', 'Positions',              'Total Positions',           '45',                           'number',  1),
      (v_main, 'organization', 'Positions',              'Position Grade Required',   'Yes',                          'boolean', 2),
      (v_main, 'organization', 'Positions',              'Default Employment Type',   'Full-time',                    'select',  3),
      (v_main, 'organization', 'Job Grades',             'Total Grades',              '5',                            'number',  1),
      (v_main, 'organization', 'Job Grades',             'Grade Naming Convention',   'Executive, Senior Management, Management, Senior Staff, Staff', 'text', 2),
      -- Attendance
      (v_main, 'attendance',   'Shift Templates',        'Total Shift Templates',     '6',                            'number',  1),
      (v_main, 'attendance',   'Shift Templates',        'Default Shift Duration',    '8 hours',                      'text',    2),
      (v_main, 'attendance',   'Shift Templates',        'Break Time Included',       'Yes',                          'boolean', 3),
      (v_main, 'attendance',   'Attendance Rules',       'Grace Period (minutes)',    '15',                           'number',  1),
      (v_main, 'attendance',   'Attendance Rules',       'Late Threshold (minutes)',  '30',                           'number',  2),
      (v_main, 'attendance',   'Attendance Rules',       'Half-day Threshold (hours)','4',                            'number',  3),
      (v_main, 'attendance',   'Overtime Rules',         'Daily Overtime Threshold (hours)',  '8',                    'number',  1),
      (v_main, 'attendance',   'Overtime Rules',         'Weekly Overtime Threshold (hours)', '40',                   'number',  2),
      (v_main, 'attendance',   'Overtime Rules',         'Weekend Rate Multiplier',   '1.5x',                         'text',    3),
      (v_main, 'attendance',   'Overtime Rules',         'Holiday Rate Multiplier',   '2.0x',                         'text',    4),
      (v_main, 'attendance',   'Holiday Calendar',       'Total Holidays',            '12',                           'number',  1),
      (v_main, 'attendance',   'Holiday Calendar',       'Auto-populate Public Holidays', 'Yes',                      'boolean', 2),
      (v_main, 'attendance',   'Holiday Calendar',       'Holiday Region',            'United States',                'select',  3),
      -- Payroll
      (v_main, 'payroll',      'Payroll Periods',        'Payroll Frequency',         'Monthly',                      'select',  1),
      (v_main, 'payroll',      'Payroll Periods',        'Pay Period Start Day',      '1st',                          'text',    2),
      (v_main, 'payroll',      'Payroll Periods',        'Pay Period End Day',        'Last Day',                     'text',    3),
      (v_main, 'payroll',      'Payroll Periods',        'Pay Day',                   '28th',                         'number',  4),
      (v_main, 'payroll',      'Salary Components',      'Total Earnings Components', '9',                            'number',  1),
      (v_main, 'payroll',      'Salary Components',      'Total Deductions Components','8',                           'number',  2),
      (v_main, 'payroll',      'Salary Components',      'Currency',                  'USD',                          'select',  3),
      (v_main, 'payroll',      'Tax Rules',              'Tax Calculation Method',    'Progressive',                  'select',  1),
      (v_main, 'payroll',      'Tax Rules',              'Federal Tax Rate',          'Variable',                     'text',    2),
      (v_main, 'payroll',      'Tax Rules',              'State Tax Rate',            'Variable',                     'text',    3),
      (v_main, 'payroll',      'Tax Rules',              'Auto-calculate Taxes',      'Yes',                          'boolean', 4),
      (v_main, 'payroll',      'Pension Rules',          'Pension Plan Type',         '401(k)',                       'select',  1),
      (v_main, 'payroll',      'Pension Rules',          'Employer Match Rate',       '5%',                           'text',    2),
      (v_main, 'payroll',      'Pension Rules',          'Employee Contribution Rate','Variable',                     'text',    3),
      (v_main, 'payroll',      'Pension Rules',          'Vesting Period (years)',    '3',                            'number',  4),
      (v_main, 'payroll',      'Bank Formats',           'Default Bank Format',       'ACH',                          'select',  1),
      (v_main, 'payroll',      'Bank Formats',           'File Format',               'NACHA',                        'select',  2),
      (v_main, 'payroll',      'Bank Formats',           'Batch Processing',          'Yes',                          'boolean', 3),
      -- Performance
      (v_main, 'performance',  'Review Templates',       'Total Templates',           '4',                            'number',  1),
      (v_main, 'performance',  'Review Templates',       'Default Review Cycle',      'Annual',                       'select',  2),
      (v_main, 'performance',  'Review Templates',       'Self-assessment Required',  'Yes',                          'boolean', 3),
      (v_main, 'performance',  'Rating Scales',          'Rating Scale Type',         '1-5 Scale',                    'select',  1),
      (v_main, 'performance',  'Rating Scales',          'Total Rating Levels',       '5',                            'number',  2),
      (v_main, 'performance',  'Rating Scales',          'Rating Labels',             'Poor, Fair, Good, Very Good, Excellent', 'text', 3),
      (v_main, 'performance',  'Competency Models',      'Total Competency Models',   '3',                            'number',  1),
      (v_main, 'performance',  'Competency Models',      'Default Competency Framework', 'Hotel Industry Standard',   'select',  2),
      (v_main, 'performance',  'Competency Models',      'Custom Competencies Allowed', 'Yes',                        'boolean', 3);
  END IF;
END $$;
