-- Migration: Seed additional F&B employees for the available-employees dropdown
-- These are unlinked employees in the Food & Beverage department, available to be
-- added to the fb_staff roster via the "Link Existing" HR link mode.
-- Mirrors migration 290 which did the same for HK and FO.

INSERT INTO employees (id, name, email, phone, department, position, hire_date, salary, status) VALUES
  ('EMP-FB-08', 'Isabella Romano',  'isabella.r@masterhotel.com', '+1 555 0308', 'Food & Beverage', 'Server',       '2024-01-20', 2400, 'Active'),
  ('EMP-FB-09', 'Kwame Mensah',     'kwame.m@masterhotel.com',    '+1 555 0309', 'Food & Beverage', 'Bartender',    '2024-02-01', 2600, 'Active'),
  ('EMP-FB-10', 'Nadia Petrova',    'nadia.p@masterhotel.com',    '+1 555 0310', 'Food & Beverage', 'Host',         '2024-02-15', 2200, 'Active'),
  ('EMP-FB-11', 'Diego Fernandez',  'diego.f@masterhotel.com',    '+1 555 0311', 'Food & Beverage', 'Chef',         '2023-12-01', 3800, 'Active'),
  ('EMP-FB-12', 'Hana Kim',         'hana.k@masterhotel.com',     '+1 555 0312', 'Food & Beverage', 'Sous Chef',    '2024-01-10', 3200, 'Active'),
  ('EMP-FB-13', 'Omar Hassan',      'omar.h@masterhotel.com',     '+1 555 0313', 'Food & Beverage', 'Busser',       '2024-03-01', 2000, 'Active'),
  ('EMP-FB-14', 'Elena Popescu',    'elena.p@masterhotel.com',    '+1 555 0314', 'Food & Beverage', 'Server',       '2024-03-15', 2400, 'Active'),
  ('EMP-FB-15', 'Marcus Lee',       'marcus.l@masterhotel.com',   '+1 555 0315', 'Food & Beverage', 'Manager',      '2023-06-01', 4500, 'Active')
ON CONFLICT (id) DO NOTHING;
