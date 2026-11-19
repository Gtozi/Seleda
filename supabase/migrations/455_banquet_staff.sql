-- Migration 455: Banquet & Events Staff Management
-- Staff assignments, attendance, training, productivity, shift and staffing
-- requirements for the Banquet & Events department — linked to HR employees.

-- =============================================================
-- 1. Banquet staff assignments (HR-linked)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.banquet_staff (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  employee_id text,
  name text NOT NULL,
  email text,
  phone text,
  role text DEFAULT 'Banquet Server',
  shift text DEFAULT 'Morning',
  function_area text DEFAULT 'Ballroom',
  status text DEFAULT 'Active Duty',
  workload numeric DEFAULT 0,
  events_handled integer DEFAULT 0,
  ytd_revenue numeric DEFAULT 0,
  property_id uuid,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. Attendance
-- =============================================================

CREATE TABLE IF NOT EXISTS public.banquet_staff_attendance (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  staff_id text REFERENCES public.banquet_staff(id) ON DELETE CASCADE,
  attendance_date date DEFAULT now(),
  status text DEFAULT 'Present',
  check_in timestamptz,
  check_out timestamptz,
  hours_worked numeric DEFAULT 0,
  overtime_hours numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 3. Training records
-- =============================================================

CREATE TABLE IF NOT EXISTS public.banquet_staff_training (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  staff_id text REFERENCES public.banquet_staff(id) ON DELETE CASCADE,
  course text NOT NULL,
  due_date date,
  status text DEFAULT 'Not Started',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 4. Productivity records
-- =============================================================

CREATE TABLE IF NOT EXISTS public.banquet_staff_productivity (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  staff_id text REFERENCES public.banquet_staff(id) ON DELETE CASCADE,
  period text DEFAULT 'MTD',
  events_worked integer DEFAULT 0,
  setup_hours numeric DEFAULT 0,
  service_hours numeric DEFAULT 0,
  guest_satisfaction numeric DEFAULT 0,
  revenue numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 5. Shift requirements
-- =============================================================

CREATE TABLE IF NOT EXISTS public.banquet_staff_shift_reqs (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  role text NOT NULL,
  shift text NOT NULL,
  required_count integer DEFAULT 0,
  assigned_count integer DEFAULT 0,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 6. Staffing requirements by function area
-- =============================================================

CREATE TABLE IF NOT EXISTS public.banquet_staff_staffing_reqs (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  function_area text NOT NULL,
  role text NOT NULL,
  required_count integer DEFAULT 0,
  assigned_count integer DEFAULT 0,
  property_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 7. Triggers
-- =============================================================

DROP TRIGGER IF EXISTS trg_banquet_staff_updated_at ON public.banquet_staff;
CREATE TRIGGER trg_banquet_staff_updated_at
  BEFORE UPDATE ON public.banquet_staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_staff_attendance_updated_at ON public.banquet_staff_attendance;
CREATE TRIGGER trg_banquet_staff_attendance_updated_at
  BEFORE UPDATE ON public.banquet_staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_staff_training_updated_at ON public.banquet_staff_training;
CREATE TRIGGER trg_banquet_staff_training_updated_at
  BEFORE UPDATE ON public.banquet_staff_training
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_staff_productivity_updated_at ON public.banquet_staff_productivity;
CREATE TRIGGER trg_banquet_staff_productivity_updated_at
  BEFORE UPDATE ON public.banquet_staff_productivity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_staff_shift_reqs_updated_at ON public.banquet_staff_shift_reqs;
CREATE TRIGGER trg_banquet_staff_shift_reqs_updated_at
  BEFORE UPDATE ON public.banquet_staff_shift_reqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_banquet_staff_staffing_reqs_updated_at ON public.banquet_staff_staffing_reqs;
CREATE TRIGGER trg_banquet_staff_staffing_reqs_updated_at
  BEFORE UPDATE ON public.banquet_staff_staffing_reqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 8. Indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_banquet_staff_property ON public.banquet_staff(property_id);
CREATE INDEX IF NOT EXISTS idx_banquet_staff_status ON public.banquet_staff(status);
CREATE INDEX IF NOT EXISTS idx_banquet_staff_role ON public.banquet_staff(role);
CREATE INDEX IF NOT EXISTS idx_banquet_staff_attendance_date ON public.banquet_staff_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_banquet_staff_attendance_staff ON public.banquet_staff_attendance(staff_id);

-- =============================================================
-- 9. RLS
-- =============================================================

ALTER TABLE public.banquet_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banquet_staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banquet_staff_training ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banquet_staff_productivity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banquet_staff_shift_reqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banquet_staff_staffing_reqs ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 10. Mock data
-- =============================================================

INSERT INTO public.banquet_staff (id, employee_id, name, email, phone, role, shift, function_area, status, workload, events_handled, ytd_revenue, property_id) VALUES
  ('bs-001', 'emp-101', 'Daniel Carter', 'daniel.carter@hotel.com', '+1 555 0201', 'Banquet Manager', 'Morning', 'Ballroom', 'Active Duty', 85, 24, 480000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bs-002', 'emp-102', 'Priya Sharma', 'priya.sharma@hotel.com', '+1 555 0202', 'Event Coordinator', 'Morning', 'Conference Rooms', 'Active Duty', 72, 18, 320000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bs-003', 'emp-103', 'Roberto Silva', 'roberto.silva@hotel.com', '+1 555 0203', 'Catering Manager', 'Morning', 'Kitchen', 'Active Duty', 68, 22, 295000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bs-004', 'emp-104', 'Emily Chen', 'emily.chen@hotel.com', '+1 555 0204', 'Setup Supervisor', 'Evening', 'Ballroom', 'Active Duty', 55, 16, 180000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bs-005', 'emp-105', 'Marcus Johnson', 'marcus.johnson@hotel.com', '+1 555 0205', 'Banquet Server', 'Evening', 'Ballroom', 'Active Duty', 40, 12, 95000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bs-006', 'emp-106', 'Aisha Mohammed', 'aisha.mohammed@hotel.com', '+1 555 0206', 'Audio/Visual Technician', 'Morning', 'Audio/Visual', 'On Leave', 0, 0, 142000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bs-007', 'emp-107', 'Tom Wilson', 'tom.wilson@hotel.com', '+1 555 0207', 'Banquet Server', 'Night', 'Outdoor Venues', 'Active Duty', 35, 8, 62000, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.banquet_staff_attendance (staff_id, attendance_date, status, check_in, check_out, hours_worked, overtime_hours, notes) VALUES
  ('bs-001', now()::date, 'Present', now() - interval '8 hours', now(), 8, 0, 'On time'),
  ('bs-002', now()::date, 'Present', now() - interval '7 hours', now(), 8, 0, null),
  ('bs-003', now()::date, 'Present', now() - interval '6 hours', now(), 8, 1, 'Overtime for wedding setup'),
  ('bs-004', now()::date, 'Late', now() - interval '4 hours', now(), 5, 0, 'Equipment delay'),
  ('bs-005', now()::date, 'Present', now() - interval '5 hours', now(), 8, 2, 'Double shift coverage')
ON CONFLICT DO NOTHING;

INSERT INTO public.banquet_staff_training (staff_id, course, due_date, status) VALUES
  ('bs-001', 'Advanced Event Management', '2026-09-30', 'In Progress'),
  ('bs-002', 'BEO Software Training', '2026-08-25', 'Completed'),
  ('bs-003', 'Food Safety Certification 2026', '2026-10-15', 'Not Started'),
  ('bs-004', 'Setup & Breakdown Best Practices', '2026-09-10', 'In Progress'),
  ('bs-006', 'AV Equipment Mastery', '2026-11-01', 'Not Started')
ON CONFLICT DO NOTHING;

INSERT INTO public.banquet_staff_productivity (staff_id, period, events_worked, setup_hours, service_hours, guest_satisfaction, revenue) VALUES
  ('bs-001', 'MTD', 8, 32, 48, 4.8, 480000),
  ('bs-002', 'MTD', 6, 24, 36, 4.9, 320000),
  ('bs-003', 'MTD', 7, 28, 42, 4.7, 295000),
  ('bs-004', 'MTD', 5, 40, 20, 4.6, 180000),
  ('bs-005', 'MTD', 4, 16, 32, 4.5, 95000),
  ('bs-006', 'MTD', 0, 0, 0, 0, 0),
  ('bs-007', 'MTD', 3, 12, 24, 4.4, 62000)
ON CONFLICT DO NOTHING;

INSERT INTO public.banquet_staff_shift_reqs (id, role, shift, required_count, assigned_count, property_id) VALUES
  ('bsr-001', 'Banquet Manager', 'Morning', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsr-002', 'Event Coordinator', 'Morning', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsr-003', 'Catering Manager', 'Morning', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsr-004', 'Setup Supervisor', 'Evening', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsr-005', 'Banquet Server', 'Evening', 6, 2, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsr-006', 'Banquet Server', 'Night', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsr-007', 'Audio/Visual Technician', 'Morning', 1, 0, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.banquet_staff_staffing_reqs (id, function_area, role, required_count, assigned_count, property_id) VALUES
  ('bssr-001', 'Ballroom', 'Banquet Server', 8, 3, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bssr-002', 'Ballroom', 'Setup Supervisor', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bssr-003', 'Conference Rooms', 'Event Coordinator', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bssr-004', 'Outdoor Venues', 'Banquet Server', 4, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bssr-005', 'Kitchen', 'Catering Manager', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bssr-006', 'Audio/Visual', 'Audio/Visual Technician', 2, 0, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
