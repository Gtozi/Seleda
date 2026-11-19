-- Migration: Seed additional HK and FO employees for the available-employees dropdown
-- These are unlinked employees in the correct department, available to be added to the roster.

INSERT INTO employees (id, name, email, phone, department, position, hire_date, salary, status) VALUES
('EMP-HK-13', 'Maria Santos', 'maria.santos@masterhotel.com', '+1 555 0113', 'Housekeeping', 'Room Attendant', '2024-01-15', 2200, 'Active'),
('EMP-HK-14', 'James Park', 'james.park@masterhotel.com', '+1 555 0114', 'Housekeeping', 'Public Area Attendant', '2024-02-01', 2200, 'Active'),
('EMP-HK-15', 'Fatima Ali', 'fatima.ali@masterhotel.com', '+1 555 0115', 'Housekeeping', 'Laundry Attendant', '2024-02-10', 2100, 'Active'),
('EMP-HK-16', 'Robert Chen', 'robert.chen@masterhotel.com', '+1 555 0116', 'Housekeeping', 'Houseperson', '2024-03-01', 2300, 'Active'),
('EMP-HK-17', 'Aisha Mohamed', 'aisha.mohamed@masterhotel.com', '+1 555 0117', 'Housekeeping', 'Room Attendant', '2024-03-15', 2200, 'Active'),
('EMP-HK-18', 'Daniel Rivera', 'daniel.rivera@masterhotel.com', '+1 555 0118', 'Housekeeping', 'Supervisor', '2023-11-01', 3200, 'Active'),
('EMP-FO-11', 'Sophia Turner', 'sophia.t@masterhotel.com', '+1 555 0211', 'Front Office', 'Front Desk Agent', '2024-01-20', 2500, 'Active'),
('EMP-FO-12', 'Lucas Wright', 'lucas.w@masterhotel.com', '+1 555 0212', 'Front Office', 'Bell Attendant', '2024-02-05', 2300, 'Active'),
('EMP-FO-13', 'Mia Johnson', 'mia.j@masterhotel.com', '+1 555 0213', 'Front Office', 'Concierge', '2024-02-15', 2600, 'Active'),
('EMP-FO-14', 'Ethan Davis', 'ethan.d@masterhotel.com', '+1 555 0214', 'Front Office', 'Night Auditor', '2024-03-01', 2800, 'Active'),
('EMP-FO-15', 'Olivia Brown', 'olivia.b@masterhotel.com', '+1 555 0215', 'Front Office', 'Guest Relations', '2024-03-10', 2500, 'Active')
ON CONFLICT (id) DO NOTHING;
