-- HR Executive Dashboard
-- Key metrics and alerts for the HR dashboard.

-- ============================================================================
-- hr_dashboard
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_dashboard (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  metric_key      TEXT NOT NULL,
  metric_group    TEXT NOT NULL,
  metric_label    TEXT NOT NULL,
  metric_value    TEXT NOT NULL,
  sub_label       TEXT,
  trend           TEXT,
  is_positive     BOOLEAN DEFAULT TRUE,
  color_tone      TEXT DEFAULT 'neutral',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_dashboard_property ON hr_dashboard(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_dashboard_group ON hr_dashboard(metric_group);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_dashboard_updated_at ON hr_dashboard;
CREATE TRIGGER hr_dashboard_updated_at
  BEFORE UPDATE ON hr_dashboard
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_dashboard TO authenticated;

ALTER TABLE hr_dashboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_dashboard_read ON hr_dashboard;
CREATE POLICY hr_dashboard_read ON hr_dashboard
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_dashboard_write ON hr_dashboard;
CREATE POLICY hr_dashboard_write ON hr_dashboard
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
  IF NOT EXISTS (SELECT 1 FROM hr_dashboard WHERE property_id = v_main) THEN
    INSERT INTO hr_dashboard (property_id, metric_key, metric_group, metric_label, metric_value, sub_label, trend, is_positive, color_tone, sort_order)
    VALUES
      -- KPIs
      (v_main, 'total_employees',    'kpi', 'Total Employees',        '248',  '12 New Hires',       '+5.2%',  TRUE,  'indigo',  1),
      (v_main, 'active_employees',   'kpi', 'Active Employees',       '235',  '94.8% Active',       '+2.1%',  TRUE,  'success', 2),
      (v_main, 'vacant_positions',   'kpi', 'Vacant Positions',       '14',   '5 Urgent',           '-8.3%',  FALSE, 'warning', 3),
      (v_main, 'employee_turnover',  'kpi', 'Employee Turnover',      '8.5%', 'Last 12 months',     '-1.2%',  TRUE,  'danger',  4),
      (v_main, 'attendance_rate',    'kpi', 'Attendance Rate',        '96.8%','This Month',         '+0.5%',  TRUE,  'accent',  5),
      (v_main, 'overtime_hours',     'kpi', 'Overtime Hours',         '142h', 'Reduced by 5%',      '-5.0%',  TRUE,  'purple',  6),
      (v_main, 'leave_utilization',  'kpi', 'Leave Utilization',      '42%',  'Avg per Dept',       '+3.2%',  TRUE,  'cyan',    7),
      (v_main, 'training_completion','kpi', 'Training Completion',    '92%',  'YTD Average',        '+4.5%',  TRUE,  'pink',    8),
      (v_main, 'payroll_cost',       'kpi', 'Payroll Cost',           '84200','This Month',         '+2.8%',  TRUE,  'success', 9),
      (v_main, 'satisfaction',       'kpi', 'Employee Satisfaction',  '4.2/5','Latest Survey',      '+0.3',   TRUE,  'yellow',  10),
      -- Alerts
      (v_main, 'probation_ending',   'alert', 'Probation Ending',     '3',  NULL, NULL, TRUE, 'amber',  1),
      (v_main, 'contract_expiry',    'alert', 'Contract Expiry',      '5',  NULL, NULL, TRUE, 'danger', 2),
      (v_main, 'visa_expiry',        'alert', 'Visa Expiry',          '2',  NULL, NULL, TRUE, 'danger', 3),
      (v_main, 'work_permit_expiry', 'alert', 'Work Permit Expiry',   '1',  NULL, NULL, TRUE, 'danger', 4),
      (v_main, 'missing_attendance', 'alert', 'Missing Attendance',   '8',  NULL, NULL, TRUE, 'amber',  5),
      (v_main, 'pending_leave',      'alert', 'Pending Leave Requests','6', NULL, NULL, TRUE, 'info',   6),
      (v_main, 'payroll_approval',   'alert', 'Payroll Approval Pending','2',NULL,NULL, TRUE, 'amber',  7),
      (v_main, 'training_expired',   'alert', 'Training Expired',     '4',  NULL, NULL, TRUE, 'danger', 8),
      (v_main, 'cert_expiring',      'alert', 'Certification Expiring', '7',NULL,NULL, TRUE, 'amber',  9);
  END IF;
END $$;
