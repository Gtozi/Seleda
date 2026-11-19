-- HR Reports & Analytics
-- Generic report catalog for HR, Attendance, Payroll, Performance, and Executive reports.

-- ============================================================================
-- hr_reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  report_type     TEXT NOT NULL DEFAULT 'hr'
                    CHECK (report_type IN ('hr', 'attendance', 'payroll', 'performance', 'executive')),
  report_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,
  last_generated  DATE,
  generated_by    TEXT,
  format          TEXT,
  file_url        TEXT,
  is_scheduled    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_reports_property ON hr_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_reports_type ON hr_reports(report_type);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_reports_updated_at ON hr_reports;
CREATE TRIGGER hr_reports_updated_at
  BEFORE UPDATE ON hr_reports
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_reports TO authenticated;

ALTER TABLE hr_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_reports_read ON hr_reports;
CREATE POLICY hr_reports_read ON hr_reports
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_reports_write ON hr_reports;
CREATE POLICY hr_reports_write ON hr_reports
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
  IF NOT EXISTS (SELECT 1 FROM hr_reports WHERE property_id = v_main) THEN
    INSERT INTO hr_reports (property_id, report_type, report_id, name, description, category, last_generated, generated_by, format, is_scheduled)
    VALUES
      -- HR
      (v_main, 'hr', 'HR-001', 'Employee Directory',    'Complete list of all employees with details',     'HR',         '2024-06-28', 'System',      'PDF, Excel',         FALSE),
      (v_main, 'hr', 'HR-002', 'Headcount Report',      'Current headcount by department and position',    'HR',         '2024-06-28', 'System',      'PDF, Excel',         FALSE),
      (v_main, 'hr', 'HR-003', 'Turnover Report',       'Employee turnover analysis and trends',           'HR',         '2024-06-25', 'HR Manager',  'PDF, Excel',         FALSE),
      (v_main, 'hr', 'HR-004', 'Recruitment Report',    'Recruitment metrics and time-to-hire analysis',   'HR',         '2024-06-20', 'HR Manager',  'PDF, Excel',         FALSE),
      -- Attendance
      (v_main, 'attendance', 'ATT-001', 'Daily Attendance',   'Daily attendance records by department',        'Attendance', '2024-06-28', 'System',      'PDF, Excel',         FALSE),
      (v_main, 'attendance', 'ATT-002', 'Late Arrivals Report','Analysis of late arrival patterns',            'Attendance', '2024-06-28', 'System',      'PDF, Excel',         FALSE),
      (v_main, 'attendance', 'ATT-003', 'Overtime Report',    'Overtime hours and cost analysis',              'Attendance', '2024-06-25', 'HR Manager',  'PDF, Excel',         FALSE),
      (v_main, 'attendance', 'ATT-004', 'Absenteeism Report', 'Absenteeism patterns and trends',               'Attendance', '2024-06-20', 'HR Manager',  'PDF, Excel',         FALSE),
      -- Payroll
      (v_main, 'payroll', 'PAY-001', 'Payroll Register',    'Detailed payroll register for current period',   'Payroll',    '2024-06-28', 'Payroll Manager', 'PDF, Excel',     TRUE),
      (v_main, 'payroll', 'PAY-002', 'Payroll Summary',     'Summary of payroll costs by department',         'Payroll',    '2024-06-28', 'Payroll Manager', 'PDF, Excel',     TRUE),
      (v_main, 'payroll', 'PAY-003', 'Tax Report',          'Tax deductions and compliance report',           'Payroll',    '2024-06-28', 'Payroll Manager', 'PDF, Excel',     FALSE),
      (v_main, 'payroll', 'PAY-004', 'Bank Transfer Report','Bank transfer file for payroll processing',      'Payroll',    '2024-06-28', 'Payroll Manager', 'Excel, CSV',     TRUE),
      -- Performance
      (v_main, 'performance', 'PERF-001', 'Performance Ratings', 'Employee performance ratings distribution',  'Performance', '2024-06-15', 'HR Manager',     'PDF, Excel',      FALSE),
      (v_main, 'performance', 'PERF-002', 'Goal Achievement',    'Goal completion rates by department',        'Performance', '2024-06-15', 'HR Manager',     'PDF, Excel',      FALSE),
      (v_main, 'performance', 'PERF-003', 'Training Completion', 'Training program completion rates',            'Performance', '2024-06-10', 'Training Manager','PDF, Excel',     FALSE),
      (v_main, 'performance', 'PERF-004', 'Succession Readiness','Succession planning readiness assessment',     'Performance', '2024-06-01', 'HR Director',    'PDF, Excel',      FALSE),
      -- Executive
      (v_main, 'executive', 'EXEC-001', 'Labor Cost Analysis',  'Comprehensive labor cost analysis and trends', 'Executive',  '2024-06-28', 'System',         'PDF, Excel, Dashboard', FALSE),
      (v_main, 'executive', 'EXEC-002', 'Revenue per Employee', 'Revenue productivity metrics',                 'Executive',  '2024-06-28', 'System',         'PDF, Excel, Dashboard', FALSE),
      (v_main, 'executive', 'EXEC-003', 'Employee Productivity','Productivity metrics and KPIs',                'Executive',  '2024-06-25', 'System',         'PDF, Excel, Dashboard', FALSE),
      (v_main, 'executive', 'EXEC-004', 'Workforce Planning',   'Workforce planning and forecasting',           'Executive',  '2024-06-20', 'HR Director',    'PDF, Excel, Dashboard', FALSE),
      (v_main, 'executive', 'EXEC-005', 'Diversity Analysis',   'Diversity and inclusion metrics',              'Executive',  '2024-06-15', 'HR Manager',     'PDF, Excel, Dashboard', FALSE);
  END IF;
END $$;
