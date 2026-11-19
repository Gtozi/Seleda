-- ============================================================================
-- 620_security_staff_mgmt.sql — Security Staff Management (full module)
-- Extends /erp/security/staff (StaffManagement.tsx) to match the HK
-- StaffManagementModule: Roster + Attendance + Shifts + Coverage +
-- Training + Performance sub-tabs.
--
--   sec_shift_defs       — shift definitions (name, start/end, required
--                          staffing); assigned counts derived live from
--                          sec_staff at read time.
--   sec_staffing_reqs    — coverage requirements per post/zone + role +
--                          shift; assigned counts derived live.
--   sec_training         — certification/training records per staff
--                          member; Expired derived server-side from
--                          expires_at (same pattern as compliance items).
--   sec_attendance       — daily attendance: date, shift, check_in/out,
--                          status, hours, overtime; UNIQUE(staff_id, date).
--   sec_performance      — per-staff period metrics: patrols completed,
--                          incidents responded, reports filed, hours, score.
--
-- All staff-linked rows CASCADE on sec_staff delete.
-- ============================================================================

-- ── Shift definitions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_shift_defs (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  name            TEXT NOT NULL,
  start_time      TEXT NOT NULL,           -- 'HH:MM' 24h
  end_time        TEXT NOT NULL,
  required_staff  INTEGER NOT NULL DEFAULT 1 CHECK (required_staff >= 0),
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, name)
);

ALTER TABLE public.sec_shift_defs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_shift_defs TO authenticated;

-- ── Staffing requirements (coverage plan) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_staffing_reqs (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  post            TEXT NOT NULL,           -- zone/post, e.g. 'Front Gate'
  role            TEXT NOT NULL CHECK (role IN (
                    'Security Officer', 'Security Supervisor', 'Security Manager',
                    'Patrol Officer', 'CCTV Operator', 'Access Control Specialist'
                  )),
  shift           TEXT NOT NULL CHECK (shift IN ('Day', 'Evening', 'Night')),
  required_count  INTEGER NOT NULL DEFAULT 1 CHECK (required_count >= 0),
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_staffing_prop ON public.sec_staffing_reqs(property_id);

ALTER TABLE public.sec_staffing_reqs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_staffing_reqs TO authenticated;

-- ── Training & certifications ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_training (
  id           TEXT PRIMARY KEY,
  property_id  UUID,
  staff_id     TEXT NOT NULL REFERENCES public.sec_staff(id) ON DELETE CASCADE,
  course       TEXT NOT NULL,
  provider     TEXT,
  completed_at DATE,
  expires_at   DATE,
  status       TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                 'Scheduled', 'In Progress', 'Completed', 'Expired'
               )),
  notes        TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_training_prop  ON public.sec_training(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_training_staff ON public.sec_training(staff_id);

ALTER TABLE public.sec_training ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_training TO authenticated;

-- ── Attendance ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_attendance (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  staff_id        TEXT NOT NULL REFERENCES public.sec_staff(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  shift           TEXT NOT NULL DEFAULT 'Day' CHECK (shift IN ('Day', 'Evening', 'Night')),
  check_in        TIMESTAMP WITH TIME ZONE,
  check_out       TIMESTAMP WITH TIME ZONE,
  status          TEXT NOT NULL DEFAULT 'Present' CHECK (status IN (
                    'Present', 'Late', 'Absent', 'On Leave', 'Sick',
                    'Half Day', 'Day Off', 'Training Day'
                  )),
  hours_worked    NUMERIC(5,2) NOT NULL DEFAULT 0,
  overtime_hours  NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_sec_attendance_prop ON public.sec_attendance(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_attendance_date ON public.sec_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_sec_attendance_staff ON public.sec_attendance(staff_id);

ALTER TABLE public.sec_attendance ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_attendance TO authenticated;

-- ── Performance ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_performance (
  id                   TEXT PRIMARY KEY,
  property_id          UUID,
  staff_id             TEXT NOT NULL REFERENCES public.sec_staff(id) ON DELETE CASCADE,
  period_date          DATE NOT NULL,      -- first of month, weekly date, etc.
  patrols_completed    INTEGER NOT NULL DEFAULT 0,
  incidents_responded  INTEGER NOT NULL DEFAULT 0,
  reports_filed        INTEGER NOT NULL DEFAULT 0,
  hours                NUMERIC(6,2) NOT NULL DEFAULT 0,
  score                NUMERIC(5,2) NOT NULL DEFAULT 0,   -- 0–100
  notes                TEXT,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_sec_performance_prop  ON public.sec_performance(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_performance_staff ON public.sec_performance(staff_id);

ALTER TABLE public.sec_performance ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_performance TO authenticated;

-- ── Seeds ────────────────────────────────────────────────────────────────
INSERT INTO public.sec_shift_defs
  (id, property_id, name, start_time, end_time, required_staff, notes)
VALUES
  ('SHF-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Day',     '07:00', '15:00', 8, 'Full lobby + patrol coverage'),
  ('SHF-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Evening', '15:00', '23:00', 6, 'Event/entrance focus'),
  ('SHF-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Night',   '23:00', '07:00', 4, 'Perimeter + control room only')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_staffing_reqs
  (id, property_id, post, role, shift, required_count, notes)
VALUES
  ('REQ-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Front Gate',    'Security Officer',         'Day',     2, 'ID checks + vehicle screening'),
  ('REQ-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Control Room',  'CCTV Operator',            'Day',     1, NULL),
  ('REQ-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Control Room',  'CCTV Operator',            'Night',   1, NULL),
  ('REQ-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Floors',  'Patrol Officer',           'Evening', 2, 'Hourly floor sweeps'),
  ('REQ-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Perimeter',     'Security Officer',         'Night',   2, 'Fence line + parking'),
  ('REQ-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Lobby',         'Security Officer',         'Evening', 1, 'VIP escort on request'),
  ('REQ-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Security Office','Security Supervisor',      'Day',     1, 'Shift command'),
  ('REQ-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Access Points', 'Access Control Specialist','Day',     1, 'Badge/keycard desk')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_training
  (id, property_id, staff_id, course, provider, completed_at, expires_at, status, notes)
VALUES
  ('TRN-001', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-003', 'First Aid & CPR',              'Red Cross',            CURRENT_DATE - INTERVAL '8 months', CURRENT_DATE + INTERVAL '4 months',  'Completed',  NULL),
  ('TRN-002', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-001', 'Fire Safety & Evacuation',     'In-house',             CURRENT_DATE - INTERVAL '11 months', CURRENT_DATE + INTERVAL '12 days', 'Completed',  'Renewal due soon'),
  ('TRN-003', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-004', 'CCTV Systems Operation',       'Vendor Academy',       CURRENT_DATE - INTERVAL '3 months',  CURRENT_DATE + INTERVAL '21 months', 'Completed',  NULL),
  ('TRN-004', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-002', 'Conflict Management',          'In-house',             NULL, NULL, 'In Progress', 'Weekly sessions, 4 of 6 done'),
  ('TRN-005', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-005', 'Crowd Control',                'Regional Academy',     NULL, NULL, 'Scheduled',  'Starts next month'),
  ('TRN-006', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-001', 'Report Writing',               'In-house',             CURRENT_DATE - INTERVAL '14 months', CURRENT_DATE - INTERVAL '2 months', 'Expired',    'Expired — schedule refresher')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_attendance
  (id, property_id, staff_id, attendance_date, shift, check_in, check_out,
   status, hours_worked, overtime_hours, notes)
VALUES
  ('ATT-001', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-001', CURRENT_DATE,            'Day',     NOW() - INTERVAL '7 hours', NULL,                      'Present',      7,    0,   NULL),
  ('ATT-002', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-002', CURRENT_DATE,            'Day',     NOW() - INTERVAL '6.5 hours', NULL,                     'Late',         6.5,  0,   'In 30 min late — transport'),
  ('ATT-003', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-003', CURRENT_DATE,            'Day',     NOW() - INTERVAL '7 hours', NULL,                      'Present',      7,    0,   NULL),
  ('ATT-004', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-004', CURRENT_DATE,            'Day',     NOW() - INTERVAL '6 hours', NOW() - INTERVAL '2 hours', 'Half Day',     4,    0,   'Left early — approved'),
  ('ATT-005', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-005', CURRENT_DATE,            'Night',   NULL, NULL,                                           'Day Off',      0,    0,   NULL),
  ('ATT-006', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-001', CURRENT_DATE - INTERVAL '1 day', 'Day', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '7 hours', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '15.5 hours', 'Present', 8.5, 0.5, NULL),
  ('ATT-007', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-002', CURRENT_DATE - INTERVAL '1 day', 'Day', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '7 hours', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '15 hours',   'Present', 8,   0,   NULL),
  ('ATT-008', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-003', CURRENT_DATE - INTERVAL '1 day', 'Day', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '7 hours', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '15 hours',   'Present', 8,   0,   NULL),
  ('ATT-009', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-004', CURRENT_DATE - INTERVAL '1 day', 'Day', NULL, NULL, 'On Leave', 0, 0, 'Approved leave'),
  ('ATT-010', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-005', CURRENT_DATE - INTERVAL '1 day', 'Night', CURRENT_DATE - INTERVAL '1 day' + INTERVAL '23 hours', CURRENT_DATE - INTERVAL '16 hours', 'Present', 8, 0, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_performance
  (id, property_id, staff_id, period_date, patrols_completed, incidents_responded, reports_filed, hours, score, notes)
VALUES
  ('PRF-001', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-001', DATE_TRUNC('month', CURRENT_DATE)::DATE, 42, 6, 12, 168, 91, 'Top performer this month'),
  ('PRF-002', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-002', DATE_TRUNC('month', CURRENT_DATE)::DATE, 38, 4, 9,  160, 84, NULL),
  ('PRF-003', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-003', DATE_TRUNC('month', CURRENT_DATE)::DATE, 15, 8, 18, 172, 88, 'Supervisory duties'),
  ('PRF-004', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-004', DATE_TRUNC('month', CURRENT_DATE)::DATE, 22, 2, 5,  120, 72, 'Reduced hours — part-time week'),
  ('PRF-005', '18762279-a389-41c9-9169-7ebc682e9703', 'STF-005', DATE_TRUNC('month', CURRENT_DATE)::DATE, 35, 3, 7,  150, 79, NULL)
ON CONFLICT (id) DO NOTHING;
