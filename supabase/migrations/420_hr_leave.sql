-- HR Leave Management
-- Ensures hr_leave_requests and hr_leave_balances are ready for the
-- manager-facing Leave Management screen. Adds department column to balances,
-- validates status values, creates triggers and indexes, and seeds the
-- placeholder demo data.

-- ============================================================================
-- Schema alignment
-- ============================================================================
ALTER TABLE hr_leave_requests
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE hr_leave_balances
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'Front Office';

-- Add CHECK constraint on status if not present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'hr_leave_requests_status_check'
  ) THEN
    ALTER TABLE hr_leave_requests
      ADD CONSTRAINT hr_leave_requests_status_check
      CHECK (status IN ('Pending', 'Approved', 'Rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_status ON hr_leave_requests(property_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_leave_requests_dates  ON hr_leave_requests(property_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_hr_leave_balances_dept   ON hr_leave_balances(property_id, department);

DROP TRIGGER IF EXISTS hr_leave_requests_updated_at ON hr_leave_requests;
CREATE TRIGGER hr_leave_requests_updated_at
  BEFORE UPDATE ON hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS hr_leave_balances_updated_at ON hr_leave_balances;
CREATE TRIGGER hr_leave_balances_updated_at
  BEFORE UPDATE ON hr_leave_balances
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_leave_balances  TO authenticated;

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Balances (department-aware)
  IF NOT EXISTS (SELECT 1 FROM hr_leave_balances WHERE property_id = v_main AND employee_name = 'Robert Wilson') THEN
    INSERT INTO hr_leave_balances (property_id, employee_id, employee_name, department, leave_type, total_days, used_days)
    VALUES
      (v_main, 'EMP-HK-01', 'Robert Wilson',  'Housekeeping', 'Annual Leave',    21, 8),
      (v_main, 'EMP-HK-01', 'Robert Wilson',  'Housekeeping', 'Sick Leave',      10, 1),
      (v_main, 'EMP-FB-01', 'Elena Martinez', 'Food & Beverage', 'Annual Leave',  18, 4),
      (v_main, 'EMP-FB-01', 'Elena Martinez', 'Food & Beverage', 'Emergency Leave', 5, 3),
      (v_main, 'EMP-ENG-01','James Chen',      'Engineering', 'Paternity Leave', 14, 0),
      (v_main, 'EMP-ENG-01','James Chen',      'Engineering', 'Annual Leave',    21, 0);
  END IF;

  -- Requests mirroring the placeholder UI
  IF NOT EXISTS (SELECT 1 FROM hr_leave_requests WHERE property_id = v_main AND employee_name = 'Elena Martinez' AND start_date = '2024-05-31') THEN
    INSERT INTO hr_leave_requests (property_id, employee_id, employee_name, leave_type, start_date, end_date, days, reason, status)
    VALUES
      (v_main, 'EMP-FB-01', 'Elena Martinez', 'Emergency', '2024-05-31', '2024-06-02', 3, 'Family emergency',     'Pending'),
      (v_main, 'EMP-ENG-01','James Chen',     'Paternity', '2024-07-10', '2024-07-24', 14, 'Newborn care',         'Pending');
  END IF;

  -- Update existing requests to match placeholder statuses
  UPDATE hr_leave_requests
    SET status = 'Pending'
    WHERE property_id = v_main AND employee_name = 'Sarah Johnson' AND start_date = '2024-06-05';

  UPDATE hr_leave_requests
    SET status = 'Approved'
    WHERE property_id = v_main AND employee_name = 'Sarah Johnson' AND start_date = '2024-05-15';

  -- Fill department for existing balances that were seeded without it
  UPDATE hr_leave_balances
    SET department = 'Front Office'
    WHERE property_id = v_main AND department IS NULL;
END $$;
