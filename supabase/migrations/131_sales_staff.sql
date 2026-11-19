-- Migration 131: Sales Staff Management
-- Staff assignments, attendance, training, productivity, shift and staffing requirements
-- integrated with HR employees.

-- =============================================================
-- 1. Sales staff assignments (HR-linked)
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_staff (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  employee_id text,
  name text NOT NULL,
  email text,
  phone text,
  role text DEFAULT 'Sales Executive',
  shift text DEFAULT 'Morning',
  territory text DEFAULT 'Local Market',
  status text DEFAULT 'Active Duty',
  workload numeric DEFAULT 0,
  sales_target numeric DEFAULT 0,
  ytd_revenue numeric DEFAULT 0,
  property_id uuid,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. Attendance
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_staff_attendance (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  staff_id text REFERENCES public.sales_staff(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.sales_staff_training (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  staff_id text REFERENCES public.sales_staff(id) ON DELETE CASCADE,
  course text NOT NULL,
  due_date date,
  status text DEFAULT 'Not Started',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 4. Productivity records
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_staff_productivity (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  staff_id text REFERENCES public.sales_staff(id) ON DELETE CASCADE,
  period text DEFAULT 'MTD',
  calls_made integer DEFAULT 0,
  meetings integer DEFAULT 0,
  deals_closed integer DEFAULT 0,
  revenue numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================
-- 5. Shift requirements
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_staff_shift_reqs (
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
-- 6. Staffing requirements by territory
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sales_staff_staffing_reqs (
  id text DEFAULT gen_random_uuid()::text PRIMARY KEY,
  territory text NOT NULL,
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

DROP TRIGGER IF EXISTS trg_sales_staff_updated_at ON public.sales_staff;
CREATE TRIGGER trg_sales_staff_updated_at
  BEFORE UPDATE ON public.sales_staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_staff_attendance_updated_at ON public.sales_staff_attendance;
CREATE TRIGGER trg_sales_staff_attendance_updated_at
  BEFORE UPDATE ON public.sales_staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_staff_training_updated_at ON public.sales_staff_training;
CREATE TRIGGER trg_sales_staff_training_updated_at
  BEFORE UPDATE ON public.sales_staff_training
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_staff_productivity_updated_at ON public.sales_staff_productivity;
CREATE TRIGGER trg_sales_staff_productivity_updated_at
  BEFORE UPDATE ON public.sales_staff_productivity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_staff_shift_reqs_updated_at ON public.sales_staff_shift_reqs;
CREATE TRIGGER trg_sales_staff_shift_reqs_updated_at
  BEFORE UPDATE ON public.sales_staff_shift_reqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sales_staff_staffing_reqs_updated_at ON public.sales_staff_staffing_reqs;
CREATE TRIGGER trg_sales_staff_staffing_reqs_updated_at
  BEFORE UPDATE ON public.sales_staff_staffing_reqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- 8. Indexes
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_staff_property ON public.sales_staff(property_id);
CREATE INDEX IF NOT EXISTS idx_sales_staff_status ON public.sales_staff(status);
CREATE INDEX IF NOT EXISTS idx_sales_staff_role ON public.sales_staff(role);
CREATE INDEX IF NOT EXISTS idx_sales_staff_attendance_date ON public.sales_staff_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_sales_staff_attendance_staff ON public.sales_staff_attendance(staff_id);

-- =============================================================
-- 9. Mock data
-- =============================================================

-- Use the first property id for mock data
INSERT INTO public.sales_staff (id, employee_id, name, email, phone, role, shift, territory, status, workload, sales_target, ytd_revenue, property_id) VALUES
  ('ss-001', 'emp-001', 'Marco Rossi', 'marco.rossi@hotel.com', '+1 555 0101', 'Sales Manager', 'Morning', 'Local Market', 'Active Duty', 78, 250000, 128000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ss-002', 'emp-002', 'Sara Ahmed', 'sara.ahmed@hotel.com', '+1 555 0102', 'Sales Executive', 'Morning', 'Corporate', 'Active Duty', 65, 180000, 96000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ss-003', 'emp-003', 'Luca Bianchi', 'luca.bianchi@hotel.com', '+1 555 0103', 'Sales Executive', 'Evening', 'Travel Agents', 'Active Duty', 82, 180000, 74000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ss-004', 'emp-004', 'Ana Costa', 'ana.costa@hotel.com', '+1 555 0104', 'Account Manager', 'Morning', 'Government', 'On Leave', 0, 220000, 112000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ss-005', 'emp-005', 'James Brown', 'james.brown@hotel.com', '+1 555 0105', 'Sales Executive', 'Night', 'Online', 'Active Duty', 45, 120000, 32000, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_staff_attendance (staff_id, attendance_date, status, check_in, check_out, hours_worked, overtime_hours, notes) VALUES
  ('ss-001', now()::date, 'Present', now() - interval '4 hours', now(), 8, 0, 'On time'),
  ('ss-002', now()::date, 'Present', now() - interval '3 hours', now(), 8, 0, null),
  ('ss-003', now()::date, 'Late', now() - interval '2 hours', now(), 7, 0, 'Traffic delay'),
  ('ss-005', now()::date, 'Present', now() - interval '5 hours', now(), 8, 1, 'Overtime coverage')
ON CONFLICT DO NOTHING;

INSERT INTO public.sales_staff_training (staff_id, course, due_date, status) VALUES
  ('ss-001', 'Advanced Negotiation Skills', '2026-09-15', 'In Progress'),
  ('ss-002', 'CRM System Training', '2026-08-30', 'Not Started'),
  ('ss-003', 'Product Knowledge 2026', '2026-08-20', 'Completed'),
  ('ss-004', 'Leadership Essentials', '2026-10-01', 'Not Started')
ON CONFLICT DO NOTHING;

INSERT INTO public.sales_staff_productivity (staff_id, period, calls_made, meetings, deals_closed, revenue) VALUES
  ('ss-001', 'MTD', 142, 38, 7, 128000),
  ('ss-002', 'MTD', 98, 24, 5, 96000),
  ('ss-003', 'MTD', 156, 41, 6, 74000),
  ('ss-004', 'MTD', 0, 0, 0, 0),
  ('ss-005', 'MTD', 210, 18, 3, 32000)
ON CONFLICT DO NOTHING;

INSERT INTO public.sales_staff_shift_reqs (id, role, shift, required_count, assigned_count, property_id) VALUES
  ('ssr-001', 'Sales Manager', 'Morning', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ssr-002', 'Sales Executive', 'Morning', 3, 2, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ssr-003', 'Sales Executive', 'Evening', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ssr-004', 'Account Manager', 'Morning', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ssr-005', 'Sales Executive', 'Night', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sales_staff_staffing_reqs (id, territory, role, required_count, assigned_count, property_id) VALUES
  ('sssr-001', 'Local Market', 'Sales Executive', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sssr-002', 'Corporate', 'Account Manager', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sssr-003', 'Travel Agents', 'Sales Executive', 1, 1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sssr-004', 'Government', 'Account Manager', 1, 0, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sssr-005', 'Online', 'Sales Executive', 2, 1, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
