-- HR Workflow & Approvals
-- Tracks approval requests and workflow templates.

-- ============================================================================
-- hr_approval_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_approval_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  request_type      TEXT NOT NULL,
  category          TEXT,
  employee          TEXT NOT NULL,
  department        TEXT,
  details           TEXT,
  submitted_date    DATE,
  priority          TEXT NOT NULL DEFAULT 'Normal'
                      CHECK (priority IN ('High', 'Normal', 'Low')),
  current_approver  TEXT,
  workflow_stage    TEXT,
  request_status    TEXT NOT NULL DEFAULT 'Pending'
                      CHECK (request_status IN ('Pending', 'Approved', 'Rejected')),
  approved_date     DATE,
  approved_by       TEXT,
  comments          TEXT,
  rejected_date     DATE,
  rejected_by       TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_approval_requests_property ON hr_approval_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_hr_approval_requests_status ON hr_approval_requests(request_status);

-- ============================================================================
-- hr_workflow_templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS hr_workflow_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  stages           JSONB NOT NULL DEFAULT '[]'::jsonb,
  average_duration TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_workflow_templates_property ON hr_workflow_templates(property_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS hr_approval_requests_updated_at ON hr_approval_requests;
CREATE TRIGGER hr_approval_requests_updated_at
  BEFORE UPDATE ON hr_approval_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_workflow_templates_updated_at ON hr_workflow_templates;
CREATE TRIGGER hr_workflow_templates_updated_at
  BEFORE UPDATE ON hr_workflow_templates
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_approval_requests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_workflow_templates  TO authenticated;

ALTER TABLE hr_approval_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_workflow_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_approval_requests_read ON hr_approval_requests;
CREATE POLICY hr_approval_requests_read ON hr_approval_requests
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_approval_requests_write ON hr_approval_requests;
CREATE POLICY hr_approval_requests_write ON hr_approval_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS hr_workflow_templates_read ON hr_workflow_templates;
CREATE POLICY hr_workflow_templates_read ON hr_workflow_templates
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS hr_workflow_templates_write ON hr_workflow_templates;
CREATE POLICY hr_workflow_templates_write ON hr_workflow_templates
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
  -- Approval requests
  IF NOT EXISTS (SELECT 1 FROM hr_approval_requests WHERE property_id = v_main) THEN
    INSERT INTO hr_approval_requests (property_id, request_type, category, employee, department, details, submitted_date, priority, current_approver, workflow_stage, request_status)
    VALUES
      (v_main, 'Leave Request',        'Leave',        'John Doe',      'Front Office', 'Annual Leave: Jun 05 - Jun 12 (7 days)',                '2024-06-01', 'Normal', 'Sarah Johnson', 'Manager Approval',     'Pending'),
      (v_main, 'Overtime Request',     'Time',         'Elena Smith',   'F&B',          'Weekend Work: 8 hours on Jun 08',                       '2024-06-02', 'High',   'Robert Wilson', 'Department Head',      'Pending'),
      (v_main, 'Expense Claim',        'Finance',      'Carlos Ray',    'Engineering',  'Travel Expense: $150 for client meeting',               '2024-06-03', 'Normal', 'Finance Manager','Finance Review',      'Pending'),
      (v_main, 'Salary Change',        'Compensation', 'Maria Garcia',  'Housekeeping', 'Promotion: Room Attendant to Supervisor (+15%)',        '2024-06-04', 'High',   'HR Director',   'HR Review',            'Pending'),
      (v_main, 'Recruitment Request',  'Recruitment',  'Sarah Johnson', 'Front Office', 'New Position: Senior Receptionist',                     '2024-06-05', 'Normal', 'General Manager','Executive Approval',  'Pending');

    INSERT INTO hr_approval_requests (property_id, request_type, category, employee, department, details, submitted_date, request_status, approved_date, approved_by, comments)
    VALUES
      (v_main, 'Leave Request',    'Leave',    'James Wilson',  'F&B',        'Sick Leave: May 30 (1 day)',            '2024-05-29', 'Approved', '2024-05-30', 'Sarah Johnson', 'Medical certificate provided'),
      (v_main, 'Training Request', 'Learning', 'Lisa Anderson', 'Front Office','Leadership Excellence Course',          '2024-05-25', 'Approved', '2024-05-28', 'HR Director',   'Approved within training budget');

    INSERT INTO hr_approval_requests (property_id, request_type, category, employee, department, details, submitted_date, request_status, rejected_date, rejected_by, reason)
    VALUES
      (v_main, 'Overtime Request', 'Time',    'Michael Chen', 'Engineering',  'Weekend Work: 12 hours on May 20', '2024-05-18', 'Rejected', '2024-05-19', 'Robert Wilson',  'Exceeds monthly overtime budget'),
      (v_main, 'Expense Claim',    'Finance', 'Anna Kim',     'Housekeeping', 'Personal Equipment: $200',         '2024-05-15', 'Rejected', '2024-05-16', 'Finance Manager','Not eligible for reimbursement');
  END IF;

  -- Workflow templates
  IF NOT EXISTS (SELECT 1 FROM hr_workflow_templates WHERE property_id = v_main) THEN
    INSERT INTO hr_workflow_templates (property_id, name, description, stages, average_duration, is_active)
    VALUES
      (v_main, 'Leave Approval Workflow',     '3-stage approval: Manager → HR → Payroll',        '["Manager Approval", "HR Review", "Payroll Notification"]'::jsonb,        '2 days', TRUE),
      (v_main, 'Recruitment Approval Workflow','4-stage approval: Manager → HR → Finance → Executive','["Manager Request", "HR Review", "Budget Approval", "Executive Approval"]'::jsonb, '5 days', TRUE),
      (v_main, 'Salary Change Workflow',      '3-stage approval: Manager → HR → Finance',        '["Manager Recommendation", "HR Review", "Finance Approval"]'::jsonb,      '7 days', TRUE);
  END IF;
END $$;
