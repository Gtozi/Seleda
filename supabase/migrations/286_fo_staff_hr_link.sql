-- Migration: Link Front Office Staff to HR Employees
-- Integrates fo_staff with the HR employees table so each FO staff member
-- is backed by a real HR employee record. Mirrors migration 282 (HK).
-- This lets the FO Staff Management module display HR data (email, phone,
-- hire date, position, salary) alongside FO-specific data (role, shift,
-- station, check-ins, satisfaction, upsell).

-- ── Seed FO employees into the HR employees table ─────────────────────
INSERT INTO employees
  (id, name, email, phone, department, position, status, hire_date, salary, avatar_initials, property_id)
VALUES
  ('EMP-FO-01', 'Sarah J.',   'sarah.j@masterhotel.com',   '+1 555 0201', 'Front Office', 'Front Desk Agent',  'Active', '2021-03-15', 2200, 'SJ', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-02', 'Michael T.', 'michael.t@masterhotel.com', '+1 555 0202', 'Front Office', 'Front Desk Agent',  'Active', '2022-07-20', 2200, 'MT', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-03', 'Emma R.',    'emma.r@masterhotel.com',    '+1 555 0203', 'Front Office', 'Cashier',           'Active', '2023-01-10', 2000, 'ER', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-04', 'David K.',   'david.k.fo@masterhotel.com',  '+1 555 0204', 'Front Office', 'Night Auditor',     'Active', '2020-11-05', 2400, 'DK', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-05', 'Lisa M.',    'lisa.m@masterhotel.com',    '+1 555 0205', 'Front Office', 'Concierge',         'Active', '2021-09-12', 2300, 'LM', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-06', 'James B.',   'james.b@masterhotel.com',   '+1 555 0206', 'Front Office', 'Bell Attendant',    'Active', '2023-04-18', 1800, 'JB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-07', 'Anna L.',    'anna.l@masterhotel.com',    '+1 555 0207', 'Front Office', 'Guest Relations',   'Active', '2022-06-01', 2500, 'AL', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-08', 'Robert C.',  'robert.c@masterhotel.com',  '+1 555 0208', 'Front Office', 'Supervisor',        'Active', '2019-02-15', 3200, 'RC', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-09', 'Maria G.',   'maria.g@masterhotel.com',   '+1 555 0209', 'Front Office', 'Front Desk Agent',  'Active', '2023-08-22', 2200, 'MG', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('EMP-FO-10', 'Kevin W.',   'kevin.w@masterhotel.com',   '+1 555 0210', 'Front Office', 'Bell Attendant',    'Active', '2022-12-10', 1800, 'KW', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Link fo_staff rows to their HR employee records ───────────────────
UPDATE fo_staff SET employee_id = 'EMP-FO-01' WHERE id = 'FO-01';
UPDATE fo_staff SET employee_id = 'EMP-FO-02' WHERE id = 'FO-02';
UPDATE fo_staff SET employee_id = 'EMP-FO-03' WHERE id = 'FO-03';
UPDATE fo_staff SET employee_id = 'EMP-FO-04' WHERE id = 'FO-04';
UPDATE fo_staff SET employee_id = 'EMP-FO-05' WHERE id = 'FO-05';
UPDATE fo_staff SET employee_id = 'EMP-FO-06' WHERE id = 'FO-06';
UPDATE fo_staff SET employee_id = 'EMP-FO-07' WHERE id = 'FO-07';
UPDATE fo_staff SET employee_id = 'EMP-FO-08' WHERE id = 'FO-08';
UPDATE fo_staff SET employee_id = 'EMP-FO-09' WHERE id = 'FO-09';
UPDATE fo_staff SET employee_id = 'EMP-FO-10' WHERE id = 'FO-10';
