-- Migration: Security Operations Center + Security Staff Management
-- Backs the /erp/security/soc tab (SecurityOperationsCenter.tsx) and the
-- /erp/security/staff tab (StaffManagement.tsx).
-- Mimics the HK/Engineering portal pattern (migrations 283/339): dept-scoped
-- tables, property scoping, RLS + authenticated CRUD grants, seed data
-- matching the former hardcoded arrays in SecurityOperationsCenter.tsx.
--
-- Seven tables:
--   1. sec_incidents                — SOC incident queue
--   2. sec_patrols                  — active patrol tracking
--   3. sec_cctv_cameras             — CCTV status board
--   4. sec_alarms                   — alarm status
--   5. sec_access_events            — access control event log
--   6. sec_emergency_notifications  — emergency notifications
--   7. sec_staff                    — security staff roster & availability

-- ── 1. Incidents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_incidents (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  incident_type   TEXT NOT NULL,
  location        TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN (
                    'Critical', 'High', 'Medium', 'Low'
                  )),
  status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                    'Active', 'In Progress', 'Pending', 'Resolved'
                  )),
  reported_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  assigned_to     TEXT,
  description     TEXT,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_incidents_prop ON public.sec_incidents(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_incidents_status ON public.sec_incidents(status);

CREATE OR REPLACE FUNCTION public.update_sec_incidents_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_incidents_updated_at ON public.sec_incidents;
CREATE TRIGGER trigger_sec_incidents_updated_at
  BEFORE UPDATE ON public.sec_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_incidents_timestamp();

ALTER TABLE public.sec_incidents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_incidents TO authenticated;

-- ── 2. Patrols ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_patrols (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  officer         TEXT NOT NULL,
  route           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                    'Scheduled', 'In Progress', 'Completed', 'Cancelled'
                  )),
  progress        INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  last_checkpoint TEXT,
  started_at      TIMESTAMP WITH TIME ZONE,
  ended_at        TIMESTAMP WITH TIME ZONE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_patrols_prop ON public.sec_patrols(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_patrols_status ON public.sec_patrols(status);

ALTER TABLE public.sec_patrols ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_patrols TO authenticated;

-- ── 3. CCTV Cameras ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_cctv_cameras (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  name            TEXT NOT NULL,
  location        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Online' CHECK (status IN (
                    'Online', 'Offline', 'Maintenance'
                  )),
  recording       BOOLEAN NOT NULL DEFAULT FALSE,
  last_motion_at  TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_cctv_prop ON public.sec_cctv_cameras(property_id);

ALTER TABLE public.sec_cctv_cameras ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_cctv_cameras TO authenticated;

-- ── 4. Alarms ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_alarms (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  alarm_type      TEXT NOT NULL,
  location        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                    'Active', 'Cleared', 'Resolved'
                  )),
  triggered_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_alarms_prop ON public.sec_alarms(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_alarms_status ON public.sec_alarms(status);

ALTER TABLE public.sec_alarms ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_alarms TO authenticated;

-- ── 5. Access Control Events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_access_events (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  event_type      TEXT NOT NULL,
  user_name       TEXT,
  location        TEXT NOT NULL,
  occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL DEFAULT 'Normal' CHECK (status IN (
                    'Normal', 'Warning', 'Flagged'
                  )),
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_access_prop ON public.sec_access_events(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_access_status ON public.sec_access_events(status);

ALTER TABLE public.sec_access_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_access_events TO authenticated;

-- ── 6. Emergency Notifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_emergency_notifications (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  emergency_type  TEXT NOT NULL,
  location        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                    'Active', 'In Progress', 'Scheduled', 'Resolved'
                  )),
  priority        TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN (
                    'Critical', 'High', 'Medium', 'Low'
                  )),
  occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_emergency_prop ON public.sec_emergency_notifications(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_emergency_status ON public.sec_emergency_notifications(status);

ALTER TABLE public.sec_emergency_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_emergency_notifications TO authenticated;

-- ── 7. Security Staff ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_staff (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  name            TEXT NOT NULL,
  avatar          TEXT,
  role            TEXT NOT NULL CHECK (role IN (
                    'Security Officer', 'Security Supervisor', 'Security Manager',
                    'Patrol Officer', 'CCTV Operator', 'Access Control Specialist'
                  )),
  status          TEXT NOT NULL DEFAULT 'Off Duty' CHECK (status IN (
                    'On Duty', 'On Break', 'Off Duty'
                  )),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  location        TEXT,
  shift           TEXT NOT NULL DEFAULT 'Day' CHECK (shift IN (
                    'Day', 'Evening', 'Night'
                  )),
  radio_channel   TEXT,
  phone           TEXT,
  email           TEXT,
  employee_id     TEXT,
  hire_date       DATE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_staff_prop ON public.sec_staff(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_staff_status ON public.sec_staff(status);

CREATE OR REPLACE FUNCTION public.update_sec_staff_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_staff_updated_at ON public.sec_staff;
CREATE TRIGGER trigger_sec_staff_updated_at
  BEFORE UPDATE ON public.sec_staff
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_staff_timestamp();

ALTER TABLE public.sec_staff ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_staff TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Seeds mirror the former hardcoded arrays in SecurityOperationsCenter.tsx.

-- 5 incidents
INSERT INTO public.sec_incidents
  (id, property_id, incident_type, location, priority, status, reported_at, assigned_to)
VALUES
  ('INC-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Unauthorized Access', 'Rear Entrance', 'High', 'Active', CURRENT_DATE + TIME '10:45', 'John D.'),
  ('INC-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Medical Emergency', 'Pool Area', 'Critical', 'In Progress', CURRENT_DATE + TIME '09:30', 'Elena R.'),
  ('INC-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Suspicious Activity', 'Parking Lot', 'Medium', 'Pending', CURRENT_DATE + TIME '08:15', NULL),
  ('INC-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Property Damage', 'Lobby', 'Low', 'Active', CURRENT_DATE + TIME '07:00', 'Carlos M.'),
  ('INC-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Fire Alarm', 'Kitchen', 'Critical', 'Resolved', CURRENT_DATE + TIME '06:30', 'Sarah L.')
ON CONFLICT (id) DO NOTHING;

-- 4 patrols
INSERT INTO public.sec_patrols
  (id, property_id, officer, route, status, progress, last_checkpoint, started_at)
VALUES
  ('PAT-001', '18762279-a389-41c9-9169-7ebc682e9703', 'John D.', 'Guest Floors', 'In Progress', 75, 'Floor 3', CURRENT_DATE + TIME '10:00'),
  ('PAT-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Elena R.', 'Public Areas', 'In Progress', 45, 'Lobby', CURRENT_DATE + TIME '10:15'),
  ('PAT-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Carlos M.', 'Perimeter', 'Completed', 100, 'Gate', CURRENT_DATE + TIME '09:00'),
  ('PAT-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Sarah L.', 'Parking', 'In Progress', 60, 'Section B', CURRENT_DATE + TIME '10:30')
ON CONFLICT (id) DO NOTHING;

-- 6 CCTV cameras
INSERT INTO public.sec_cctv_cameras
  (id, property_id, name, location, status, recording, last_motion_at)
VALUES
  ('CAM-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Lobby Entrance', 'Main Building', 'Online', TRUE, CURRENT_DATE + TIME '10:42'),
  ('CAM-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Reception Desk', 'Main Building', 'Online', TRUE, CURRENT_DATE + TIME '10:44'),
  ('CAM-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Elevator Bank', 'Main Building', 'Online', TRUE, CURRENT_DATE + TIME '10:40'),
  ('CAM-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Parking Lot', 'Exterior', 'Offline', FALSE, CURRENT_DATE + TIME '08:15'),
  ('CAM-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Pool Area', 'Recreation', 'Online', TRUE, CURRENT_DATE + TIME '10:30'),
  ('CAM-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Rear Entrance', 'Exterior', 'Online', TRUE, CURRENT_DATE + TIME '10:35')
ON CONFLICT (id) DO NOTHING;

-- 4 alarms
INSERT INTO public.sec_alarms
  (id, property_id, alarm_type, location, status, triggered_at, acknowledged, acknowledged_at)
VALUES
  ('ALM-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Fire Alarm', 'Kitchen', 'Active', CURRENT_DATE + TIME '09:30', FALSE, NULL),
  ('ALM-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Door Alarm', 'Server Room', 'Cleared', CURRENT_DATE + TIME '08:15', TRUE, CURRENT_DATE + TIME '08:20'),
  ('ALM-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Motion Alarm', 'Storage Room', 'Active', CURRENT_DATE + TIME '07:00', FALSE, NULL),
  ('ALM-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Panic Alarm', 'Room 204', 'Resolved', CURRENT_DATE + TIME '06:30', TRUE, CURRENT_DATE + TIME '06:40')
ON CONFLICT (id) DO NOTHING;

-- 5 access control events
INSERT INTO public.sec_access_events
  (id, property_id, event_type, user_name, location, occurred_at, status)
VALUES
  ('ACC-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Access Denied', 'Unknown Card', 'Rear Entrance', CURRENT_DATE + TIME '10:45', 'Flagged'),
  ('ACC-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Access Granted', 'John D.', 'Main Entrance', CURRENT_DATE + TIME '10:40', 'Normal'),
  ('ACC-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Access Denied', 'Expired Card', 'Server Room', CURRENT_DATE + TIME '10:35', 'Flagged'),
  ('ACC-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Access Granted', 'Elena R.', 'Office Area', CURRENT_DATE + TIME '10:30', 'Normal'),
  ('ACC-005', '18762279-a389-41c9-9169-7ebc682e9703', 'After Hours Access', 'Carlos M.', 'Maintenance', CURRENT_DATE + TIME '10:25', 'Warning')
ON CONFLICT (id) DO NOTHING;

-- 3 emergency notifications
INSERT INTO public.sec_emergency_notifications
  (id, property_id, emergency_type, location, status, priority, occurred_at)
VALUES
  ('EMG-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Fire Emergency', 'Kitchen', 'Active', 'Critical', CURRENT_DATE + TIME '09:30'),
  ('EMG-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Medical Emergency', 'Pool Area', 'In Progress', 'High', CURRENT_DATE + TIME '09:30'),
  ('EMG-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Evacuation Drill', 'All Areas', 'Scheduled', 'Medium', CURRENT_DATE + TIME '14:00')
ON CONFLICT (id) DO NOTHING;

-- 5 security staff (matching the former staffAvailability array)
INSERT INTO public.sec_staff
  (id, property_id, name, avatar, role, status, is_active, location, shift, radio_channel)
VALUES
  ('STF-001', '18762279-a389-41c9-9169-7ebc682e9703', 'John D.', 'JD', 'Security Officer', 'On Duty', TRUE, 'Guest Floors', 'Day', 'CH-1'),
  ('STF-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Elena R.', 'ER', 'Security Officer', 'On Duty', TRUE, 'Pool Area', 'Day', 'CH-2'),
  ('STF-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Carlos M.', 'CM', 'Security Supervisor', 'On Duty', TRUE, 'Security Office', 'Day', 'CH-1'),
  ('STF-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Sarah L.', 'SL', 'Security Officer', 'On Break', TRUE, 'Break Room', 'Day', 'CH-3'),
  ('STF-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Mike T.', 'MT', 'Security Officer', 'Off Duty', TRUE, 'Off Site', 'Night', 'Off')
ON CONFLICT (id) DO NOTHING;
