-- Migration: Security Fire & Life Safety
-- Backs the /erp/security/fire-safety tab (FireLifeSafety.tsx).
--
-- Two tables:
--   1. sec_fire_equipment   — fire/life-safety equipment register
--      (alarm panels, detectors, sprinklers, extinguishers, exit signs,
--       emergency lights, pull stations, fire doors)
--   2. sec_fire_activities  — inspections, alarm tests and drills
--      (nullable FK to equipment for area-wide events; completing an
--       inspection updates the equipment's last/next inspection dates)

-- ── 1. Equipment register ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_fire_equipment (
  id               TEXT PRIMARY KEY,
  property_id      UUID,
  name             TEXT NOT NULL,
  equipment_type   TEXT NOT NULL DEFAULT 'Other' CHECK (equipment_type IN (
                     'Fire Alarm Panel', 'Smoke Detector', 'Heat Detector',
                     'Sprinkler', 'Fire Extinguisher', 'Exit Sign',
                     'Emergency Light', 'Pull Station', 'Fire Door',
                     'Fire Hose', 'Fire Pump', 'Other'
                   )),
  location         TEXT NOT NULL,
  zone             TEXT,
  status           TEXT NOT NULL DEFAULT 'Operational' CHECK (status IN (
                     'Operational', 'Needs Service', 'Out of Service', 'Under Test'
                   )),
  serial_number    TEXT,
  model            TEXT,
  installed_date   DATE,
  last_inspection  DATE,
  next_due         DATE,
  notes            TEXT,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_fire_eq_prop ON public.sec_fire_equipment(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_fire_eq_status ON public.sec_fire_equipment(status);
CREATE INDEX IF NOT EXISTS idx_sec_fire_eq_due ON public.sec_fire_equipment(next_due);

CREATE OR REPLACE FUNCTION public.update_sec_fire_equipment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_fire_equipment_updated_at ON public.sec_fire_equipment;
CREATE TRIGGER trigger_sec_fire_equipment_updated_at
  BEFORE UPDATE ON public.sec_fire_equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_fire_equipment_timestamp();

ALTER TABLE public.sec_fire_equipment ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_fire_equipment TO authenticated;

-- ── 2. Activities (inspections / tests / drills) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_fire_activities (
  id             TEXT PRIMARY KEY,
  property_id    UUID,
  equipment_id   TEXT REFERENCES public.sec_fire_equipment(id) ON DELETE SET NULL,
  activity_type  TEXT NOT NULL CHECK (activity_type IN (
                   'Inspection', 'Alarm Test', 'Drill', 'Maintenance'
                 )),
  title          TEXT NOT NULL,
  scope          TEXT,
  status         TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                   'Scheduled', 'In Progress', 'Completed', 'Overdue', 'Cancelled'
                 )),
  result         TEXT CHECK (result IN ('Pass', 'Pass with Notes', 'Fail')),
  inspector      TEXT,
  scheduled_at   TIMESTAMP WITH TIME ZONE,
  completed_at   TIMESTAMP WITH TIME ZONE,
  participants   INTEGER,
  evacuation_time_sec INTEGER,
  findings       TEXT,
  created_by     TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_fire_act_prop ON public.sec_fire_activities(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_fire_act_status ON public.sec_fire_activities(status);
CREATE INDEX IF NOT EXISTS idx_sec_fire_act_eq ON public.sec_fire_activities(equipment_id);

CREATE OR REPLACE FUNCTION public.update_sec_fire_activities_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_fire_activities_updated_at ON public.sec_fire_activities;
CREATE TRIGGER trigger_sec_fire_activities_updated_at
  BEFORE UPDATE ON public.sec_fire_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_fire_activities_timestamp();

ALTER TABLE public.sec_fire_activities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_fire_activities TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_fire_equipment
  (id, property_id, name, equipment_type, location, zone, status,
   serial_number, model, installed_date, last_inspection, next_due, notes)
VALUES
  ('FE-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Main Fire Alarm Panel', 'Fire Alarm Panel', 'Security Office', 'Main Building', 'Operational',
   'FAP-2020-4471', 'Notifier NFS2-3030', '2020-03-15', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '10 days', 'Quarterly service contract with vendor'),
  ('FE-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Sprinkler Zone — Guest Floors', 'Sprinkler', 'Floors 1-8 Riser Room', 'Guest Floors', 'Operational',
   'SPR-2019-0120', 'Viking Zone Valve', '2019-06-01', CURRENT_DATE - INTERVAL '35 days', CURRENT_DATE + INTERVAL '55 days', NULL),
  ('FE-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Kitchen Suppression System', 'Sprinkler', 'Kitchen', 'Main Building', 'Needs Service',
   'ANS-2018-0092', 'Ansul R-102', '2018-11-20', CURRENT_DATE - INTERVAL '70 days', CURRENT_DATE - INTERVAL '5 days', 'OVERDUE — nozzle cap missing on hood 2'),
  ('FE-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Extinguisher — Lobby', 'Fire Extinguisher', 'Lobby - Pillar 2', 'Public Areas', 'Operational',
   'EXT-4482', 'Amerex 10lb ABC', '2021-01-10', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '15 days', NULL),
  ('FE-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Extinguisher — Parking B1', 'Fire Extinguisher', 'Parking Level B1', 'Parking', 'Needs Service',
   'EXT-4491', 'Amerex 10lb ABC', '2021-01-10', CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '2 days', 'Pressure gauge low — recharge needed'),
  ('FE-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Exit Signs — Floor 3 Corridor', 'Exit Sign', 'Floor 3 Corridor', 'Guest Floors', 'Operational',
   NULL, 'Dual-Lite LED', '2020-08-01', CURRENT_DATE - INTERVAL '25 days', CURRENT_DATE + INTERVAL '5 days', NULL),
  ('FE-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Emergency Lights — Stairwell A', 'Emergency Light', 'Stairwell A', 'Main Building', 'Out of Service',
   'EL-2210', 'Sure-Lites SL', '2019-04-15', CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '10 days', 'Battery pack failed — replacement ordered'),
  ('FE-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Pull Station — Rear Entrance', 'Pull Station', 'Rear Entrance', 'Exterior', 'Operational',
   'PS-1188', 'Honeywell S464', '2020-03-15', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '10 days', NULL),
  ('FE-009', '18762279-a389-41c9-9169-7ebc682e9703', 'Fire Door — Kitchen Corridor', 'Fire Door', 'Kitchen Corridor', 'Main Building', 'Operational',
   NULL, 'Rated 90min self-closing', '2019-06-01', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '60 days', 'Check self-closer tension quarterly'),
  ('FE-010', '18762279-a389-41c9-9169-7ebc682e9703', 'Smoke Detectors — Conference Wing', 'Smoke Detector', 'Conference Rooms A-D', 'Main Building', 'Under Test',
   NULL, 'System Sensor 2W-B', '2020-03-15', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '85 days', 'Sensitivity test in progress')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_fire_activities
  (id, property_id, equipment_id, activity_type, title, scope, status, result,
   inspector, scheduled_at, completed_at, participants, evacuation_time_sec, findings)
VALUES
  ('FA-001', '18762279-a389-41c9-9169-7ebc682e9703', 'FE-001', 'Inspection', 'Quarterly Alarm Panel Inspection', 'Main Building', 'Completed', 'Pass',
   'SafeGuard Systems', CURRENT_DATE - INTERVAL '20 days' + TIME '10:00', CURRENT_DATE - INTERVAL '20 days' + TIME '12:30', NULL, NULL,
   'All zones reporting. Battery backup at 92%.'),
  ('FA-002', '18762279-a389-41c9-9169-7ebc682e9703', 'FE-003', 'Inspection', 'Kitchen Suppression Inspection', 'Kitchen', 'Overdue', NULL,
   'SafeGuard Systems', CURRENT_DATE - INTERVAL '5 days' + TIME '09:00', NULL, NULL, NULL,
   'OVERDUE — reschedule urgently; hood nozzle cap missing'),
  ('FA-003', '18762279-a389-41c9-9169-7ebc682e9703', NULL, 'Drill', 'Quarterly Evacuation Drill', 'All Areas', 'Scheduled', NULL,
   'Security Manager', CURRENT_DATE + TIME '14:00', NULL, NULL, NULL,
   'Coordinate with EMG-003 drill schedule'),
  ('FA-004', '18762279-a389-41c9-9169-7ebc682e9703', 'FE-004', 'Inspection', 'Monthly Extinguisher Check — Public Areas', 'Public Areas', 'Completed', 'Pass with Notes',
   'Carlos M.', CURRENT_DATE - INTERVAL '15 days' + TIME '08:00', CURRENT_DATE - INTERVAL '15 days' + TIME '09:30', NULL, NULL,
   'All tags current. Lobby unit pin replaced.'),
  ('FA-005', '18762279-a389-41c9-9169-7ebc682e9703', NULL, 'Drill', 'Night Shift Tabletop Drill', 'Security Office', 'Completed', 'Pass',
   'Security Manager', CURRENT_DATE - INTERVAL '12 days' + TIME '22:00', CURRENT_DATE - INTERVAL '12 days' + TIME '23:00', 8, 240,
   'Tabletop scenario: kitchen fire + elevator recall. Response within target.'),
  ('FA-006', '18762279-a389-41c9-9169-7ebc682e9703', 'FE-010', 'Alarm Test', 'Smoke Detector Sensitivity Test', 'Conference Wing', 'In Progress', NULL,
   'SafeGuard Systems', CURRENT_DATE + TIME '08:00', NULL, NULL, NULL,
   'Testing detector sensitivity per NFPA 72'),
  ('FA-007', '18762279-a389-41c9-9169-7ebc682e9703', 'FE-005', 'Maintenance', 'Extinguisher Recharge — Parking B1', 'Parking', 'Scheduled', NULL,
   'SafeGuard Systems', CURRENT_DATE + INTERVAL '2 days' + TIME '09:00', NULL, NULL, NULL,
   'Recharge low-pressure unit'),
  ('FA-008', '18762279-a389-41c9-9169-7ebc682e9703', 'FE-007', 'Maintenance', 'Emergency Light Battery Replacement', 'Stairwell A', 'Scheduled', NULL,
   'Engineering', CURRENT_DATE + INTERVAL '3 days' + TIME '10:00', NULL, NULL, NULL,
   'Install replacement battery pack when delivered')
ON CONFLICT (id) DO NOTHING;
