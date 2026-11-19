-- 476_spa_staff_operations.sql
--
-- Upgrades the Spa & Wellness staff module to mirror the Housekeeping Staff
-- Management pattern (docs/Housekeeping Portal new.md §10):
--   - spa_therapists becomes the unified staff roster (therapists, stylists,
--     estheticians, nail techs, fitness instructors, reception, supervisors)
--     with role / shift / workload / HR employee link.
--   - Beauty Salon stylists are moved into the shared roster.
--   - New operations tables: shift requirements, staffing requirements,
--     training assignments, productivity records.
--   - staff_attendance is extended with a 'SPA' department scope so the same
--     shared attendance table serves Housekeeping, Front Office and Spa.

-- ── Extend the staff roster ────────────────────────────────────────────────

ALTER TABLE public.spa_therapists
  ADD COLUMN IF NOT EXISTS role         TEXT NOT NULL DEFAULT 'Therapist'
    CHECK (role IN ('Therapist','Stylist','Esthetician','Nail Technician','Makeup Artist','Barber','Fitness Instructor','Receptionist','Supervisor')),
  ADD COLUMN IF NOT EXISTS shift        TEXT NOT NULL DEFAULT 'Morning'
    CHECK (shift IN ('Morning','Evening','Night')),
  ADD COLUMN IF NOT EXISTS workload     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_id  TEXT;

CREATE INDEX IF NOT EXISTS idx_spa_therapists_role ON public.spa_therapists(role);
CREATE INDEX IF NOT EXISTS idx_spa_therapists_shift ON public.spa_therapists(shift);

-- Classify the existing roster.
UPDATE public.spa_therapists SET role = 'Therapist',          shift = 'Morning', workload = 70 WHERE id = 'THP-001';
UPDATE public.spa_therapists SET role = 'Therapist',          shift = 'Morning', workload = 65 WHERE id = 'THP-002';
UPDATE public.spa_therapists SET role = 'Esthetician',        shift = 'Morning', workload = 55 WHERE id = 'THP-003';
UPDATE public.spa_therapists SET role = 'Stylist',            shift = 'Evening', workload = 0  WHERE id = 'THP-004';
UPDATE public.spa_therapists SET role = 'Fitness Instructor', shift = 'Morning', workload = 40 WHERE id = 'THP-005';

-- ── Move Beauty Salon stylists into the shared roster ──────────────────────

INSERT INTO public.spa_therapists
  (id, name, title, specialties, certifications, languages, status, employment_type, rating, email, phone, hire_date, role, shift, workload)
VALUES
  ('STY-001', 'Emma Davis',    'Hair Stylist',     ARRAY['Haircut','Styling','Coloring'],                    ARRAY['Cosmetology License','Color Specialist Certified'], ARRAY['English'],          'Active',   'Full-time', 4.8, 'emma.davis@spahotel.com',    '+1-555-0201', '2023-02-12', 'Stylist',          'Morning', 60),
  ('STY-002', 'James Brown',   'Barber',           ARRAY['Barber Services','Beard Styling','Men''s Cuts'],   ARRAY['Barber License'],                                    ARRAY['English','Arabic'], 'Active',   'Full-time', 4.7, 'james.brown@spahotel.com',   '+1-555-0202', '2023-05-03', 'Barber',           'Evening', 55),
  ('STY-003', 'Lisa Park',     'Nail Technician',  ARRAY['Nail Services','Manicure','Pedicure'],             ARRAY['Nail Technician Certification'],                    ARRAY['English','Korean'], 'Active',   'Part-time', 4.9, 'lisa.park.salon@spahotel.com','+1-555-0203','2024-01-15', 'Nail Technician',  'Morning', 50),
  ('STY-004', 'Sarah Johnson', 'Makeup Artist',    ARRAY['Makeup','Bridal Services','Special Occasion'],     ARRAY['Makeup Artist Certified'],                           ARRAY['English'],          'Active',   'Contract',  4.9, 'sarah.j.mua@spahotel.com',   '+1-555-0204', '2024-06-20', 'Makeup Artist',    'Evening', 45)
ON CONFLICT (id) DO NOTHING;

-- ── Operations tables (mirror hk_* equivalents) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.spa_shift_requirements (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name           TEXT NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  assigned_staff INTEGER NOT NULL DEFAULT 0,
  required_staff INTEGER NOT NULL DEFAULT 0,
  property_id    UUID REFERENCES public.properties(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.spa_shift_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_spa_shift_requirements_property ON public.spa_shift_requirements(property_id);

-- Per work-area, per-role staffing requirement vs. assigned headcount.
CREATE TABLE IF NOT EXISTS public.spa_staffing_requirements (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  work_area      TEXT,
  role           TEXT NOT NULL,
  required_count INTEGER NOT NULL DEFAULT 0,
  assigned_count INTEGER NOT NULL DEFAULT 0,
  shift          TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN ('Morning','Evening','Night')),
  property_id    UUID REFERENCES public.properties(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.spa_staffing_requirements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_spa_staffing_requirements_property ON public.spa_staffing_requirements(property_id);

CREATE TABLE IF NOT EXISTS public.spa_staff_training (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  course      TEXT NOT NULL,
  employee_id TEXT,
  staff_id    TEXT REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Completed','Overdue')),
  property_id UUID REFERENCES public.properties(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.spa_staff_training ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_spa_staff_training_staff ON public.spa_staff_training(staff_id);
CREATE INDEX IF NOT EXISTS idx_spa_staff_training_status ON public.spa_staff_training(status);

CREATE TABLE IF NOT EXISTS public.spa_staff_productivity (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  employee_id          TEXT,
  staff_id             TEXT REFERENCES public.spa_therapists(id) ON DELETE SET NULL,
  treatments_completed INTEGER NOT NULL DEFAULT 0,
  hours                NUMERIC(6,2) NOT NULL DEFAULT 0,
  guest_satisfaction   INTEGER NOT NULL DEFAULT 0,
  productivity_score   NUMERIC(5,2) NOT NULL DEFAULT 0,
  period_date          DATE,
  property_id          UUID REFERENCES public.properties(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.spa_staff_productivity ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_spa_staff_productivity_staff ON public.spa_staff_productivity(staff_id);

-- ── RLS policies (authenticated CRUD — banquet convention) ─────────────────

CREATE POLICY spa_shift_requirements_authenticated ON public.spa_shift_requirements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_shift_requirements TO authenticated;

CREATE POLICY spa_staffing_requirements_authenticated ON public.spa_staffing_requirements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_staffing_requirements TO authenticated;

CREATE POLICY spa_staff_training_authenticated ON public.spa_staff_training
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_staff_training TO authenticated;

CREATE POLICY spa_staff_productivity_authenticated ON public.spa_staff_productivity
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spa_staff_productivity TO authenticated;

-- ── Shared attendance table: add the SPA scope ─────────────────────────────

ALTER TABLE public.staff_attendance DROP CONSTRAINT IF EXISTS staff_attendance_department_scope_check;
ALTER TABLE public.staff_attendance ADD CONSTRAINT staff_attendance_department_scope_check
  CHECK (department_scope IN ('HK','FO','FB','ENG','SPA'));

-- ── Seeds (main property) ──────────────────────────────────────────────────

INSERT INTO public.spa_shift_requirements (id, name, start_time, end_time, assigned_staff, required_staff, property_id)
SELECT * FROM (VALUES
  ('SPSH-01','Morning Shift','08:00'::time,'16:00'::time,5,6,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSH-02','Evening Shift','14:00'::time,'22:00'::time,3,4,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSH-03','Weekend Cover','09:00'::time,'18:00'::time,4,5,'18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, name, start_time, end_time, assigned_staff, required_staff, property_id)
WHERE NOT EXISTS (SELECT 1 FROM public.spa_shift_requirements s WHERE s.id = v.id);

INSERT INTO public.spa_staffing_requirements (id, work_area, role, required_count, assigned_count, shift, property_id)
SELECT * FROM (VALUES
  ('SPSF-01','Spa Floor',     'Therapist',          3,3,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSF-02','Salon',         'Stylist',            3,2,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSF-03','Thermal Suite', 'Therapist',          1,1,'Evening','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSF-04','Fitness Center','Fitness Instructor', 1,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSF-05','Reception',     'Receptionist',       1,0,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPSF-06',NULL,            'Supervisor',         1,1,'Morning','18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, work_area, role, required_count, assigned_count, shift, property_id)
WHERE NOT EXISTS (SELECT 1 FROM public.spa_staffing_requirements s WHERE s.id = v.id);

INSERT INTO public.spa_staff_training (id, course, staff_id, due_date, status, property_id)
SELECT * FROM (VALUES
  ('SPTR-01','Hot Stone Therapy Recertification','THP-001','2026-10-15'::date,'In Progress','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPTR-02','Advanced Deep Tissue Techniques','THP-002','2026-11-01'::date,'Not Started','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPTR-03','Skincare Product Line Training','THP-003','2026-09-05'::date,'Overdue','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPTR-04','Bridal Makeup Masterclass','STY-004','2026-10-20'::date,'In Progress','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPTR-05','Guest Service Excellence','STY-001','2026-09-30'::date,'Not Started','18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPTR-06','Sanitation & Hygiene Standards','THP-005','2026-08-28'::date,'Completed','18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, course, staff_id, due_date, status, property_id)
WHERE NOT EXISTS (SELECT 1 FROM public.spa_staff_training t WHERE t.id = v.id);

INSERT INTO public.spa_staff_productivity (id, staff_id, treatments_completed, hours, guest_satisfaction, productivity_score, period_date, property_id)
SELECT * FROM (VALUES
  ('SPPR-01','THP-001',8, 8,97,95.50,CURRENT_DATE - 1,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPPR-02','THP-002',6, 8,93,91.00,CURRENT_DATE - 1,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPPR-03','THP-003',7, 8,96,94.00,CURRENT_DATE - 1,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPPR-04','STY-001',9, 8,95,93.50,CURRENT_DATE - 1,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPPR-05','STY-003',6, 6,98,96.00,CURRENT_DATE - 1,'18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('SPPR-06','THP-005',4, 8,94,92.00,CURRENT_DATE - 1,'18762279-a389-41c9-9169-7ebc682e9703'::uuid)
) AS v(id, staff_id, treatments_completed, hours, guest_satisfaction, productivity_score, period_date, property_id)
WHERE NOT EXISTS (SELECT 1 FROM public.spa_staff_productivity p WHERE p.id = v.id);

-- Seed last 5 days of attendance for the spa roster (shared staff_attendance table).
INSERT INTO public.staff_attendance (id, property_id, staff_id, staff_name, department_scope, attendance_date, shift, check_in, check_out, status, hours_worked, overtime_hours)
SELECT
  'ATT-SPA-' || s.id || '-' || (d::date - '2024-01-01'::date),
  COALESCE(s.property_id, '18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  s.id,
  s.name,
  'SPA',
  d,
  s.shift,
  d::timestamptz + INTERVAL '8 hours',
  d::timestamptz + INTERVAL '16 hours',
  CASE WHEN random() < 0.1 THEN 'Late' WHEN random() < 0.05 THEN 'Absent' ELSE 'Present' END,
  8,
  CASE WHEN random() < 0.2 THEN 1 ELSE 0 END
FROM public.spa_therapists s
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '4 days')::date,
  CURRENT_DATE::date,
  INTERVAL '1 day'
) AS d
WHERE s.status = 'Active'
ON CONFLICT (id) DO NOTHING;
