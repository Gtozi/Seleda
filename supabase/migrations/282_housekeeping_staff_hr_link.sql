-- Migration: Link Housekeeping Staff to HR Employees
-- Integrates the housekeeping_staff table with the HR employees table so each
-- housekeeping staff member is backed by a real HR employee record. This lets
-- the Staff Management module display HR data (email, phone, hire date,
-- position, salary) alongside housekeeping-specific data (role, shift, floor,
-- zone, workload), and ensures payroll/attendance in HR covers housekeeping
-- staff automatically.

-- ── Add employee_id FK to housekeeping_staff ───────────────────────────
ALTER TABLE housekeeping_staff
  ADD COLUMN IF NOT EXISTS employee_id TEXT;

-- Index for the join
CREATE INDEX IF NOT EXISTS idx_hk_staff_employee_id
  ON housekeeping_staff(employee_id);

-- ── Seed housekeeping employees into the HR employees table ────────────
-- The employees table columns: id, name, email, phone, department, position,
-- status, hire_date, salary, avatar_initials, property_id.
-- We insert one employee row per housekeeping staff member, then link them.
INSERT INTO employees
  (id, name, email, phone, department, position, status, hire_date, salary, avatar_initials, property_id)
VALUES
  ('EMP-HK-01', 'Elena R.',   'elena.r@masterhotel.com',   '+1 555 0101', 'Housekeeping', 'Room Attendant',        'Active', '2022-03-15', 1800, 'ER', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-02', 'Carlos M.',  'carlos.m@masterhotel.com',  '+1 555 0102', 'Housekeeping', 'Room Attendant',        'Active', '2021-07-20', 1800, 'CM', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-03', 'Aisha P.',   'aisha.p@masterhotel.com',   '+1 555 0103', 'Housekeeping', 'Supervisor',            'Active', '2020-01-10', 2800, 'AP', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-04', 'David K.',   'david.k@masterhotel.com',   '+1 555 0104', 'Housekeeping', 'Room Attendant',        'Active', '2023-02-01', 1800, 'DK', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-05', 'Maria S.',   'maria.s@masterhotel.com',   '+1 555 0105', 'Housekeeping', 'Room Attendant',        'Active', '2022-09-12', 1800, 'MS', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-06', 'James L.',   'james.l@masterhotel.com',   '+1 555 0106', 'Housekeeping', 'Room Attendant',        'Active', '2023-05-18', 1800, 'JL', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-07', 'Priya K.',   'priya.k@masterhotel.com',   '+1 555 0107', 'Housekeeping', 'Public Area Attendant', 'Active', '2023-06-01', 1700, 'PK', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-08', 'Daniel R.',  'daniel.r@masterhotel.com',  '+1 555 0108', 'Housekeeping', 'Public Area Attendant', 'Active', '2022-11-15', 1700, 'DR', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-09', 'Aisha B.',   'aisha.b@masterhotel.com',   '+1 555 0109', 'Housekeeping', 'Laundry Attendant',     'Active', '2023-01-20', 1700, 'AB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-10', 'Carlos M.',  'carlos.m2@masterhotel.com', '+1 555 0110', 'Housekeeping', 'Laundry Attendant',     'Active', '2023-04-05', 1700, 'CM', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-11', 'Sofia V.',   'sofia.v@masterhotel.com',   '+1 555 0111', 'Housekeeping', 'Houseperson',           'Active', '2022-08-22', 1600, 'SV', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-HK-12', 'Liam O.',    'liam.o@masterhotel.com',    '+1 555 0112', 'Housekeeping', 'Houseperson',           'Active', '2023-03-10', 1600, 'LO', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Link housekeeping_staff rows to their HR employee records ───────────
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-01' WHERE id = 'HK-01';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-02' WHERE id = 'HK-02';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-03' WHERE id = 'HK-03';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-04' WHERE id = 'HK-04';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-05' WHERE id = 'HK-05';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-06' WHERE id = 'HK-06';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-07' WHERE id = 'HK-07';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-08' WHERE id = 'HK-08';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-09' WHERE id = 'HK-09';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-10' WHERE id = 'HK-10';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-11' WHERE id = 'HK-11';
UPDATE housekeeping_staff SET employee_id = 'EMP-HK-12' WHERE id = 'HK-12';
