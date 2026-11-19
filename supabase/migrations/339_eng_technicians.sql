-- Migration: Engineering Technicians & Staff Management
-- Backs the /erp/maintenance/staff tab (StaffManagement.tsx).
-- Mimics the HK Staff Management pattern (migrations 311-320) but adapted
-- for engineering roles (Electrician, Plumber, HVAC, General, Supervisor).
--
-- Five tables:
--   1. eng_technicians       — technician roster (role, shift, status, KPIs)
--   2. eng_tech_shifts       — shift requirements (per shift, required vs assigned)
--   3. eng_tech_staffing     — staffing requirements (per role/zone, required vs assigned)
--   4. eng_tech_training     — training records (course, status, due date)
--   5. eng_tech_productivity — productivity metrics (jobs, hours, response time, score)

-- ── 1. Technicians ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_technicians (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  name            TEXT NOT NULL,
  avatar          TEXT,
  role            TEXT NOT NULL CHECK (role IN (
                    'Electrician', 'Plumber', 'HVAC Technician',
                    'General Technician', 'Supervisor', 'Locksmith',
                    'AV / IT Technician', 'External Contractor'
                  )),
  shift           TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN (
                    'Morning', 'Evening', 'Night'
                  )),
  status          TEXT NOT NULL DEFAULT 'Available' CHECK (status IN (
                    'Available', 'On Task', 'Off Duty', 'Emergency'
                  )),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  zone            TEXT,
  jobs_completed  INTEGER NOT NULL DEFAULT 0,
  avg_response_min INTEGER NOT NULL DEFAULT 0,
  workload        INTEGER NOT NULL DEFAULT 0 CHECK (workload BETWEEN 0 AND 100),
  skills          TEXT[],
  phone           TEXT,
  email           TEXT,
  employee_id     TEXT,
  hire_date       DATE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_tech_property ON public.eng_technicians(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_tech_role ON public.eng_technicians(role);

CREATE OR REPLACE FUNCTION public.update_eng_technicians_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_tech_updated_at ON public.eng_technicians;
CREATE TRIGGER trigger_eng_tech_updated_at
  BEFORE UPDATE ON public.eng_technicians
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_technicians_timestamp();

ALTER TABLE public.eng_technicians ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_technicians TO authenticated;

-- ── 2. Shift Requirements ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_tech_shifts (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  name            TEXT NOT NULL,
  shift           TEXT NOT NULL CHECK (shift IN ('Morning', 'Evening', 'Night')),
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  assigned_staff  INTEGER NOT NULL DEFAULT 0,
  required_staff  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_eng_tech_shifts_prop ON public.eng_tech_shifts(property_id);

ALTER TABLE public.eng_tech_shifts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_tech_shifts TO authenticated;

-- ── 3. Staffing Requirements ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_tech_staffing (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  role            TEXT NOT NULL,
  zone            TEXT,
  shift           TEXT NOT NULL CHECK (shift IN ('Morning', 'Evening', 'Night')),
  required_count  INTEGER NOT NULL DEFAULT 1,
  assigned_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_eng_tech_staffing_prop ON public.eng_tech_staffing(property_id);

ALTER TABLE public.eng_tech_staffing ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_tech_staffing TO authenticated;

-- ── 4. Training ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_tech_training (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  technician_id   TEXT,
  course          TEXT NOT NULL,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN (
                    'Not Started', 'In Progress', 'Completed', 'Overdue'
                  )),
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_tech_training_prop ON public.eng_tech_training(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_tech_training_tech ON public.eng_tech_training(technician_id);

ALTER TABLE public.eng_tech_training ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_tech_training TO authenticated;

-- ── 5. Productivity ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_tech_productivity (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  technician_id   TEXT,
  jobs_completed  INTEGER NOT NULL DEFAULT 0,
  hours           NUMERIC(8,1) NOT NULL DEFAULT 0,
  avg_response_min INTEGER NOT NULL DEFAULT 0,
  productivity_score INTEGER NOT NULL DEFAULT 0 CHECK (productivity_score BETWEEN 0 AND 100),
  period_date     DATE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_tech_prod_prop ON public.eng_tech_productivity(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_tech_prod_tech ON public.eng_tech_productivity(technician_id);

ALTER TABLE public.eng_tech_productivity ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_tech_productivity TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

-- 5 technicians (matching the hardcoded staff array in StaffManagement.tsx)
INSERT INTO public.eng_technicians
  (id, property_id, name, avatar, role, shift, status, is_active, zone,
   jobs_completed, avg_response_min, workload, skills, phone, email, hire_date)
VALUES
  ('ENG-T-01', '18762279-a389-41c9-9169-7ebc682e9703', 'Tadesse Bekele', 'TB', 'Plumber', 'Morning', 'On Task', TRUE, 'Zone A',
   5, 14, 75, ARRAY['Plumbing','Pipe Fitting','Welding'], '+251911000001', 'tadesse.b@seleda.com', '2023-03-15'),
  ('ENG-T-02', '18762279-a389-41c9-9169-7ebc682e9703', 'Solomon Girma', 'SG', 'Electrician', 'Morning', 'Available', TRUE, 'Zone B',
   3, 18, 45, ARRAY['Electrical','Wiring','Panel Boards'], '+251911000002', 'solomon.g@seleda.com', '2023-06-20'),
  ('ENG-T-03', '18762279-a389-41c9-9169-7ebc682e9703', 'Haile Mariam', 'HM', 'HVAC Technician', 'Evening', 'On Task', TRUE, 'Zone C',
   4, 22, 60, ARRAY['HVAC','Refrigeration','Compressors'], '+251911000003', 'haile.m@seleda.com', '2022-11-10'),
  ('ENG-T-04', '18762279-a389-41c9-9169-7ebc682e9703', 'Dawit Tadesse', 'DT', 'General Technician', 'Evening', 'Off Duty', TRUE, 'Zone A',
   0, 16, 0, ARRAY['Carpentry','Painting','General'], '+251911000004', 'dawit.t@seleda.com', '2024-01-05'),
  ('ENG-T-05', '18762279-a389-41c9-9169-7ebc682e9703', 'Abebe Kebede', 'AK', 'Supervisor', 'Morning', 'Available', TRUE, 'Zone A',
   2, 10, 30, ARRAY['Supervision','Planning','Safety'], '+251911000005', 'abebe.k@seleda.com', '2021-08-01')
ON CONFLICT (id) DO NOTHING;

-- 3 shift requirements
INSERT INTO public.eng_tech_shifts (id, property_id, name, shift, start_time, end_time, assigned_staff, required_staff) VALUES
  ('ETS-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Morning Shift', 'Morning', '06:00', '14:00', 3, 4),
  ('ETS-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Evening Shift', 'Evening', '14:00', '22:00', 2, 3),
  ('ETS-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Night Shift', 'Night', '22:00', '06:00', 0, 2)
ON CONFLICT (id) DO NOTHING;

-- 4 staffing requirements
INSERT INTO public.eng_tech_staffing (id, property_id, role, zone, shift, required_count, assigned_count) VALUES
  ('ETSF-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Plumber', 'Zone A', 'Morning', 1, 1),
  ('ETSF-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Electrician', 'Zone B', 'Morning', 1, 1),
  ('ETSF-003', '18762279-a389-41c9-9169-7ebc682e9703', 'HVAC Technician', 'Zone C', 'Evening', 1, 1),
  ('ETSF-004', '18762279-a389-41c9-9169-7ebc682e9703', 'General Technician', 'Zone A', 'Evening', 1, 0)
ON CONFLICT (id) DO NOTHING;

-- 4 training records
INSERT INTO public.eng_tech_training (id, property_id, technician_id, course, due_date, status) VALUES
  ('ETT-001', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-01', 'Advanced Pipe Welding', '2026-09-15', 'In Progress'),
  ('ETT-002', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-02', 'Electrical Safety Certification', '2026-08-30', 'Not Started'),
  ('ETT-003', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-03', 'HVAC Compressor Overhaul', '2026-07-20', 'Completed'),
  ('ETT-004', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-05', 'OSHA Safety Leadership', '2026-06-15', 'Overdue')
ON CONFLICT (id) DO NOTHING;

-- 5 productivity records (one per technician)
INSERT INTO public.eng_tech_productivity (id, property_id, technician_id, jobs_completed, hours, avg_response_min, productivity_score, period_date) VALUES
  ('ETP-001', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-01', 25, 160, 14, 92, CURRENT_DATE),
  ('ETP-002', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-02', 18, 140, 18, 85, CURRENT_DATE),
  ('ETP-003', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-03', 22, 155, 22, 78, CURRENT_DATE),
  ('ETP-004', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-04', 15, 120, 16, 80, CURRENT_DATE),
  ('ETP-005', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-T-05', 12, 100, 10, 95, CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;
