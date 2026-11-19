-- HR Attendance Management seed
-- Reuses the shared staff_attendance table (migration 287) to populate
-- attendance records for the manager-facing AttendanceManagement screen.

DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Idempotency guard — seed once per property
  IF EXISTS (SELECT 1 FROM staff_attendance WHERE property_id = v_main_property AND attendance_date = '2024-05-30' AND staff_name = 'Sarah Johnson') THEN
    RETURN;
  END IF;

  INSERT INTO staff_attendance (
    id, property_id, staff_id, staff_name, department_scope, attendance_date,
    shift, check_in, check_out, status, hours_worked, overtime_hours, employee_id, notes
  ) VALUES
    -- May 30, 2024 (today's registry shown in the placeholder)
    ('ATT-SJ-20240530', v_main_property, 'STAFF-SJ', 'Sarah Johnson',   'FO',  '2024-05-30', 'Morning', '2024-05-30 07:52:00+00', '2024-05-30 16:15:00+00', 'Present',   8.00, 0.25, 'EMP-FO-MGR', 'Regular day'),
    ('ATT-RW-20240530', v_main_property, 'STAFF-RW', 'Robert Wilson',   'ENG', '2024-05-30', 'Morning', '2024-05-30 08:05:00+00', NULL,                      'Late',      0.00, 0.00, 'H-1025',     'Pending check-out'),
    ('ATT-JC-20240530', v_main_property, 'STAFF-JC', 'James Chen',      'HK',  '2024-05-30', 'Morning', '2024-05-30 07:30:00+00', '2024-05-30 15:45:00+00', 'Present',   8.00, 0.50, 'H-1027',     'Extra floor coverage'),
    ('ATT-JD-20240530', v_main_property, 'STAFF-JD', 'John Doe',        'FB',  '2024-05-30', 'Evening', NULL,                     NULL,                      'Absent',    0.00, 0.00, 'EMP-FO-01',  'Sick leave not recorded yet'),
    ('ATT-EL-20240530', v_main_property, 'STAFF-EL', 'Elena Martinez',  'FB',  '2024-05-30', 'Morning', '2024-05-30 06:45:00+00', '2024-05-30 15:15:00+00', 'Present',   8.50, 0.00, 'H-1026',     NULL),
    ('ATT-DK-20240530', v_main_property, 'STAFF-DK', 'David Kim',       'ENG', '2024-05-30', 'Evening', '2024-05-30 14:00:00+00', '2024-05-30 22:00:00+00', 'Present',   8.00, 0.00, 'H-1032',     NULL),
    ('ATT-AH-20240530', v_main_property, 'STAFF-AH', 'Ahmed Hassan',    'FB',  '2024-05-30', 'Morning', '2024-05-30 08:00:00+00', '2024-05-30 16:00:00+00', 'Present',   8.00, 0.00, 'H-1030',     NULL),
    ('ATT-AB-20240530', v_main_property, 'STAFF-AB', 'Aisha B.',        'HK',  '2024-05-30', 'Morning', '2024-05-30 07:15:00+00', '2024-05-30 15:15:00+00', 'Present',   8.00, 0.00, 'EMP-HK-09',  NULL),
    ('ATT-AL-20240530', v_main_property, 'STAFF-AL', 'Anna L.',         'FO',  '2024-05-30', 'Evening', '2024-05-30 14:05:00+00', NULL,                      'Late',      0.00, 0.00, 'EMP-FO-07',  NULL),
    -- May 29, 2024 (previous day)
    ('ATT-SJ-20240529', v_main_property, 'STAFF-SJ', 'Sarah Johnson',   'FO',  '2024-05-29', 'Morning', '2024-05-29 07:55:00+00', '2024-05-29 16:00:00+00', 'Present',   8.00, 0.00, 'EMP-FO-MGR', NULL),
    ('ATT-RW-20240529', v_main_property, 'STAFF-RW', 'Robert Wilson',   'ENG', '2024-05-29', 'Morning', '2024-05-29 07:45:00+00', '2024-05-29 15:45:00+00', 'Present',   8.00, 1.00, 'H-1025',     'Emergency AC repair'),
    ('ATT-JC-20240529', v_main_property, 'STAFF-JC', 'James Chen',      'HK',  '2024-05-29', 'Morning', '2024-05-29 07:30:00+00', '2024-05-29 15:30:00+00', 'Present',   8.00, 0.00, 'H-1027',     NULL),
    ('ATT-JD-20240529', v_main_property, 'STAFF-JD', 'John Doe',        'FB',  '2024-05-29', 'Evening', NULL,                     NULL,                      'Absent',    0.00, 0.00, 'EMP-FO-01',  NULL),
    ('ATT-DK-20240529', v_main_property, 'STAFF-DK', 'David Kim',       'ENG', '2024-05-29', 'Evening', '2024-05-29 14:00:00+00', '2024-05-29 22:00:00+00', 'Present',   8.00, 0.00, 'H-1032',     NULL),
    -- May 28, 2024
    ('ATT-SJ-20240528', v_main_property, 'STAFF-SJ', 'Sarah Johnson',   'FO',  '2024-05-28', 'Morning', '2024-05-28 07:50:00+00', '2024-05-28 16:10:00+00', 'Present',   8.25, 0.25, 'EMP-FO-MGR', NULL),
    ('ATT-RW-20240528', v_main_property, 'STAFF-RW', 'Robert Wilson',   'ENG', '2024-05-28', 'Morning', '2024-05-28 07:45:00+00', '2024-05-28 15:45:00+00', 'Present',   8.00, 0.00, 'H-1025',     NULL),
    ('ATT-JC-20240528', v_main_property, 'STAFF-JC', 'James Chen',      'HK',  '2024-05-28', 'Morning', '2024-05-28 07:30:00+00', '2024-05-28 15:45:00+00', 'Present',   8.00, 0.50, 'H-1027',     NULL),
    ('ATT-EL-20240528', v_main_property, 'STAFF-EL', 'Elena Martinez',  'FB',  '2024-05-28', 'Morning', '2024-05-28 06:45:00+00', '2024-05-28 15:15:00+00', 'Present',   8.50, 0.00, 'H-1026',     NULL),
    ('ATT-AH-20240528', v_main_property, 'STAFF-AH', 'Ahmed Hassan',    'FB',  '2024-05-28', 'Morning', '2024-05-28 08:00:00+00', '2024-05-28 16:00:00+00', 'Present',   8.00, 0.00, 'H-1030',     NULL);
END $$;
