-- HR Employee Directory enhancements
-- Adds the missing profile columns to the existing employees table so the
-- EmployeeDirectory component can be DB-integrated, and seeds mock data for
-- the Gheralta Main Property (GH-MAIN).
--
-- New columns: employee_number, gender, date_of_birth, nationality,
--              employment_type
-- (avatar_initials, salary, hire_date, department, position, status,
--  property_id, email, phone already exist.)

-- ============================================================================
-- Add missing columns
-- ============================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IS NULL OR gender IN ('Male', 'Female', 'Other'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT
  CHECK (employment_type IS NULL OR employment_type IN ('Full-time', 'Part-time', 'Contract'));

-- Backfill employee_number from id for existing rows that don't have one.
UPDATE employees SET employee_number = id WHERE employee_number IS NULL;

-- Default employment_type for existing active employees.
UPDATE employees SET employment_type = 'Full-time' WHERE employment_type IS NULL AND status = 'Active';

CREATE INDEX IF NOT EXISTS idx_employees_employee_number ON employees(employee_number);
CREATE INDEX IF NOT EXISTS idx_employees_property ON employees(property_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);

-- ============================================================================
-- Mock data seed — placeholder employees from EmployeeDirectory.tsx + more
-- Linked to Gheralta Main Property (GH-MAIN).
-- ============================================================================
DO $$
DECLARE
  v_main_property UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Only seed if the placeholder employees don't already exist.
  IF EXISTS (SELECT 1 FROM employees WHERE email = 's.johnson@masterhotel.com') THEN
    RETURN;
  END IF;

  INSERT INTO employees
    (id, employee_number, name, email, phone, department, position, status,
     hire_date, salary, gender, date_of_birth, nationality, employment_type,
     property_id, avatar_initials)
  VALUES
    ('EMP-DIR-001', 'H-1024', 'Sarah Johnson',  's.johnson@masterhotel.com',  '+1 234 567 8901', 'Front Office',  'Front Office Manager',    'Active', '2021-03-12', 85000,  'Female', '1988-06-15', 'American',  'Full-time', v_main_property, 'SJ'),
    ('EMP-DIR-002', 'H-1025', 'Robert Wilson',   'r.wilson@masterhotel.com',   '+1 234 567 8902', 'Engineering',   'Chief Engineer',          'Active', '2020-11-05', 78000,  'Male',   '1982-09-22', 'British',   'Full-time', v_main_property, 'RW'),
    ('EMP-DIR-003', 'H-1026', 'Elena Martinez',  'e.martinez@masterhotel.com', '+1 234 567 8903', 'Food & Beverage','Executive Chef',          'Active', '2022-01-20', 95000,  'Female', '1990-02-14', 'Spanish',   'Full-time', v_main_property, 'EM'),
    ('EMP-DIR-004', 'H-1027', 'James Chen',      'j.chen@masterhotel.com',     '+1 234 567 8904', 'Housekeeping',  'Executive Housekeeper',   'Active', '2019-05-15', 72000,  'Male',   '1985-11-30', 'Chinese',   'Full-time', v_main_property, 'JC'),
    ('EMP-DIR-005', 'H-1028', 'Michael O\'Brien','m.obrien@masterhotel.com',   '+1 234 567 8905', 'Front Office',  'Receptionist',            'Active', '2023-08-01', 38000,  'Male',   '1995-04-18', 'Irish',     'Full-time', v_main_property, 'MO'),
    ('EMP-DIR-006', 'H-1029', 'Priya Sharma',    'p.sharma@masterhotel.com',   '+1 234 567 8906', 'Front Office',  'Concierge',               'Active', '2022-06-15', 42000,  'Female', '1993-12-03', 'Indian',    'Full-time', v_main_property, 'PS'),
    ('EMP-DIR-007', 'H-1030', 'Ahmed Hassan',    'a.hassan@masterhotel.com',   '+1 234 567 8907', 'Food & Beverage','Line Cook',              'Active', '2023-03-20', 35000,  'Male',   '1996-07-09', 'Egyptian',  'Full-time', v_main_property, 'AH'),
    ('EMP-DIR-008', 'H-1031', 'Maria Garcia',    'm.garcia@masterhotel.com',   '+1 234 567 8908', 'Housekeeping',  'Room Attendant',          'Active', '2023-01-10', 32000,  'Female', '1994-10-25', 'Mexican',   'Full-time', v_main_property, 'MG'),
    ('EMP-DIR-009', 'H-1032', 'David Kim',       'd.kim@masterhotel.com',      '+1 234 567 8909', 'Engineering',   'Maintenance Technician',  'Active', '2021-09-01', 45000,  'Male',   '1989-03-14', 'Korean',    'Full-time', v_main_property, 'DK'),
    ('EMP-DIR-010', 'H-1033', 'Fatima Noor',     'f.noor@masterhotel.com',     '+1 234 567 8910', 'Food & Beverage','Server',                'Active', '2024-02-01', 30000,  'Female', '1998-05-22', 'Turkish',   'Part-time', v_main_property, 'FN'),
    ('EMP-DIR-011', 'H-1034', 'Lucas Brown',     'l.brown@masterhotel.com',    '+1 234 567 8911', 'Front Office',  'Bell Attendant',          'Active', '2024-05-01', 28000, 'Male',   '2000-01-30', 'American',  'Full-time', v_main_property, 'LB'),
    ('EMP-DIR-012', 'H-1035', 'Sofia Rossi',     's.rossi@masterhotel.com',    '+1 234 567 8912', 'Housekeeping',  'Public Area Attendant',   'Active', '2023-11-15', 30000,  'Female', '1996-08-17', 'Italian',   'Full-time', v_main_property, 'SR');
END $$;
