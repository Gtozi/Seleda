-- Fill HR Configuration with all setup categories from
-- docs/Human Resources & Payroll Portal new.md §27 Configuration.

DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- HR Setup: Organization Structure
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'organization', 'Organization Structure', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Company Legal Name',        'Master Hotel Group',      'text',    1),
    ('Hotel / Property',          'Grand Hotel - Main',      'text',    2),
    ('Business Unit',             'Accommodation Division',  'text',    3),
    ('Cost Center Prefix',        'CC-HR-',                  'text',    4)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'organization' AND category = 'Organization Structure' AND setting_name = s.name
  );

  -- HR Setup: Employment Types
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'organization', 'Employment Types', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Allowed Employment Types',  'Full-time, Part-time, Contract, Temporary, Intern', 'text', 1),
    ('Default Employment Type',   'Full-time', 'select', 2),
    ('Probation Period (days)',   '90',        'number', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'organization' AND category = 'Employment Types' AND setting_name = s.name
  );

  -- HR Setup: Job Grades
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'organization', 'Job Grades', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Number of Grades',          '5',   'number', 1),
    ('Grade Names',               'Executive, Senior Management, Management, Senior Staff, Staff', 'text', 2)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'organization' AND category = 'Job Grades' AND setting_name = s.name
  );

  -- Attendance Setup: Shift Templates
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'attendance', 'Shift Templates', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Shift Types',               'Morning, Evening, Night, Split Shift, Flexible, On Call', 'text', 1),
    ('Default Shift Duration',    '8 hours', 'text', 2)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'attendance' AND category = 'Shift Templates' AND setting_name = s.name
  );

  -- Attendance Setup: Attendance Rules
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'attendance', 'Attendance Rules', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Grace Period (minutes)',    '15', 'number', 1),
    ('Late Threshold (minutes)',  '30', 'number', 2),
    ('Half-day Threshold (hours)','4',  'number', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'attendance' AND category = 'Attendance Rules' AND setting_name = s.name
  );

  -- Attendance Setup: Overtime Rules
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'attendance', 'Overtime Rules', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Daily Overtime Threshold (hours)',  '8',    'number', 1),
    ('Weekly Overtime Threshold (hours)', '40',   'number', 2),
    ('Weekend Rate Multiplier',           '1.5x', 'text',   3),
    ('Holiday Rate Multiplier',           '2.0x', 'text',   4)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'attendance' AND category = 'Overtime Rules' AND setting_name = s.name
  );

  -- Attendance Setup: Holiday Calendar
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'attendance', 'Holiday Calendar', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Working Days per Week',     '6',              'number', 1),
    ('Public Holidays per Year',  '12',             'number', 2),
    ('Holiday Region',            'United States',  'select', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'attendance' AND category = 'Holiday Calendar' AND setting_name = s.name
  );

  -- Payroll Setup: Payroll Periods
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'payroll', 'Payroll Periods', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Payroll Frequency',         'Monthly', 'select', 1),
    ('Pay Period Start Day',      '1st',     'text',   2),
    ('Pay Period End Day',        'Last Day','text',   3),
    ('Pay Day',                   '28th',    'number', 4)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'payroll' AND category = 'Payroll Periods' AND setting_name = s.name
  );

  -- Payroll Setup: Salary Components
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'payroll', 'Salary Components', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Earnings Components',       'Basic Salary, Housing, Transport, Meal, Overtime, Bonus, Incentive, Service Charge, Commission, Tips', 'text', 1),
    ('Deduction Components',      'Income Tax, Pension, Insurance, Loan, Salary Advance, Absence, Other', 'text', 2),
    ('Currency',                  'ETB', 'select', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'payroll' AND category = 'Salary Components' AND setting_name = s.name
  );

  -- Payroll Setup: Deduction Rules
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'payroll', 'Deduction Rules', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Apply Loan Deductions',     'Yes',    'boolean', 1),
    ('Apply Salary Advance Deductions', 'Yes', 'boolean', 2),
    ('Absence Deduction Method',  'Pro-rata', 'select', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'payroll' AND category = 'Deduction Rules' AND setting_name = s.name
  );

  -- Payroll Setup: Tax Rules
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'payroll', 'Tax Rules', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Tax Calculation Method',    'Progressive', 'select', 1),
    ('Auto-calculate Taxes',      'Yes',         'boolean', 2)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'payroll' AND category = 'Tax Rules' AND setting_name = s.name
  );

  -- Payroll Setup: Pension Rules
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'payroll', 'Pension Rules', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Pension Plan Type',         '401(k)', 'select', 1),
    ('Employer Match Rate',       '5%',     'text',   2),
    ('Employee Contribution Rate','Variable', 'text', 3),
    ('Vesting Period (years)',    '3',      'number', 4)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'payroll' AND category = 'Pension Rules' AND setting_name = s.name
  );

  -- Payroll Setup: Bank Formats
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'payroll', 'Bank Formats', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Default Bank Format',       'ACH',    'select', 1),
    ('File Format',               'NACHA',  'select', 2),
    ('Batch Processing',          'Yes',    'boolean', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'payroll' AND category = 'Bank Formats' AND setting_name = s.name
  );

  -- Performance Setup: Review Templates
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'performance', 'Review Templates', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Number of Templates',       '4',      'number',  1),
    ('Default Review Cycle',      'Annual', 'select',  2),
    ('Self-assessment Required',  'Yes',    'boolean', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'performance' AND category = 'Review Templates' AND setting_name = s.name
  );

  -- Performance Setup: Rating Scales
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'performance', 'Rating Scales', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Rating Scale Type',         '1-5 Scale', 'select', 1),
    ('Rating Levels',             '5',         'number', 2),
    ('Rating Labels',             'Poor, Fair, Good, Very Good, Excellent', 'text', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'performance' AND category = 'Rating Scales' AND setting_name = s.name
  );

  -- Performance Setup: Competency Models
  INSERT INTO hr_configuration (property_id, config_group, category, setting_name, setting_value, setting_type, sort_order)
  SELECT v_main, 'performance', 'Competency Models', s.name, s.value, s.type, s.ord
  FROM (VALUES
    ('Number of Models',             '3', 'number', 1),
    ('Default Competency Framework', 'Hotel Industry Standard', 'select', 2),
    ('Custom Competencies Allowed',  'Yes', 'boolean', 3)
  ) AS s(name, value, type, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM hr_configuration
    WHERE property_id = v_main AND config_group = 'performance' AND category = 'Competency Models' AND setting_name = s.name
  );
END $$;
