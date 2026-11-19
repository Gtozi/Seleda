-- Migration: Housekeeping Staff Management
-- Extends the existing housekeeping_staff table with the columns backing the
-- Staff Management module (docs/Housekeeping Portal new.md §10) and seeds mock
-- data that includes the full range of housekeeping roles — Room Attendant,
-- Public Area Attendant, Laundry Attendant, Supervisor, and Houseperson.
--
-- The existing housekeeping_staff table (created by an earlier migration) has:
--   id, property_id, name, avatar, status, solved_today, quality_score,
--   is_active, created_at, updated_at
-- This migration adds: role, shift, floor, zone, rooms_completed,
-- cleaning_time_min, inspection_score, workload.
-- Assigned rooms are derived at query time from housekeeping_assignments
-- (staff_id -> room_number), so no denormalized column is needed.

-- ── Add columns ─────────────────────────────────────────────────────────
ALTER TABLE housekeeping_staff
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Room Attendant' CHECK (role IN (
    'Room Attendant', 'Public Area Attendant', 'Laundry Attendant',
    'Supervisor', 'Houseperson'
  )),
  ADD COLUMN IF NOT EXISTS shift TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN (
    'Morning', 'Evening', 'Night'
  )),
  ADD COLUMN IF NOT EXISTS floor INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS zone TEXT NOT NULL DEFAULT 'Zone A',
  ADD COLUMN IF NOT EXISTS rooms_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleaning_time_min INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inspection_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workload INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_hk_staff_property
  ON housekeeping_staff(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_staff_role
  ON housekeeping_staff(role);
CREATE INDEX IF NOT EXISTS idx_hk_staff_shift
  ON housekeeping_staff(shift);

-- ── Seed / update mock data ─────────────────────────────────────────────
-- The single demo property is 18762279-a389-41c9-9169-7ebc682e9703.
-- Existing rows HK-01..HK-04 are updated with role/shift/metrics, and new
-- rows HK-05..HK-10 are inserted to cover Public Area Attendant and Laundry
-- Attendant roles plus additional Room Attendants.

-- Update existing staff with role/shift/metrics
UPDATE housekeeping_staff SET role = 'Room Attendant',  shift = 'Morning', floor = 1, zone = 'Zone A', rooms_completed = 6, cleaning_time_min = 22, inspection_score = 96, workload = 85 WHERE id = 'HK-01';
UPDATE housekeeping_staff SET role = 'Room Attendant',  shift = 'Morning', floor = 2, zone = 'Zone A', rooms_completed = 5, cleaning_time_min = 25, inspection_score = 92, workload = 70 WHERE id = 'HK-02';
UPDATE housekeeping_staff SET role = 'Supervisor',      shift = 'Morning', floor = 1, zone = 'Zone A', rooms_completed = 0, cleaning_time_min = 0,  inspection_score = 95, workload = 40 WHERE id = 'HK-03';
UPDATE housekeeping_staff SET role = 'Room Attendant',  shift = 'Night',   floor = 4, zone = 'Zone C', rooms_completed = 3, cleaning_time_min = 30, inspection_score = 90, workload = 55 WHERE id = 'HK-04';

-- Insert new staff covering the expanded role set
INSERT INTO housekeeping_staff
  (id, property_id, name, avatar, status, solved_today, quality_score, is_active, role, shift, floor, zone, rooms_completed, cleaning_time_min, inspection_score, workload)
VALUES
  ('HK-05', '18762279-a389-41c9-9169-7ebc682e9703', 'Maria S.',   'MS', 'Active Duty', 4, 94, true, 'Room Attendant',       'Evening', 3, 'Zone B', 4, 28, 88, 60),
  ('HK-06', '18762279-a389-41c9-9169-7ebc682e9703', 'James L.',   'JL', 'Active Duty', 3, 90, true, 'Room Attendant',       'Morning', 2, 'Zone A', 5, 25, 92, 70),
  ('HK-07', '18762279-a389-41c9-9169-7ebc682e9703', 'Priya K.',   'PK', 'On Break',    2, 89, true, 'Public Area Attendant','Evening', 1, 'Zone B', 0, 0,  0,  50),
  ('HK-08', '18762279-a389-41c9-9169-7ebc682e9703', 'Daniel R.',  'DR', 'Active Duty', 3, 91, true, 'Public Area Attendant','Morning', 1, 'Zone A', 0, 0,  0,  45),
  ('HK-09', '18762279-a389-41c9-9169-7ebc682e9703', 'Aisha B.',   'AB', 'Active Duty', 5, 93, true, 'Laundry Attendant',    'Evening', 1, 'Zone B', 0, 0,  0,  65),
  ('HK-10', '18762279-a389-41c9-9169-7ebc682e9703', 'Carlos M.',  'CM', 'Off Duty',    0, 0,  true, 'Laundry Attendant',    'Night',   1, 'Zone C', 0, 0,  0,  30),
  ('HK-11', '18762279-a389-41c9-9169-7ebc682e9703', 'Sofia V.',   'SV', 'Active Duty', 6, 97, true, 'Houseperson',          'Morning', 2, 'Zone B', 0, 0,  0,  50),
  ('HK-12', '18762279-a389-41c9-9169-7ebc682e9703', 'Liam O.',    'LO', 'Active Duty', 2, 85, true, 'Houseperson',          'Night',   3, 'Zone C', 0, 0,  0,  35)
ON CONFLICT (id) DO NOTHING;

-- ── Seed room assignments for the room attendants ───────────────────────
-- housekeeping_assignments links staff_id -> room_number. Seed a few so the
-- Staff Management module shows assigned rooms for the room attendants.
INSERT INTO housekeeping_assignments (id, property_id, staff_id, room_number)
VALUES
  ('ASGN-SM-01', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-01', '02'),
  ('ASGN-SM-02', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-01', '04'),
  ('ASGN-SM-03', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-01', '06'),
  ('ASGN-SM-04', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-02', '09'),
  ('ASGN-SM-05', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-02', '10'),
  ('ASGN-SM-06', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-04', '02'),
  ('ASGN-SM-07', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-05', '04'),
  ('ASGN-SM-08', '18762279-a389-41c9-9169-7ebc682e9703', 'HK-06', '06')
ON CONFLICT (property_id, staff_id, room_number) DO NOTHING;
