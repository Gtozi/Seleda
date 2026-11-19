-- Migration: F&B Staff Roster (aligns F&B with HK staff management architecture)
-- Creates a dedicated fb_staff table with F&B-specific operational fields and an
-- optional HR employee link — mirroring housekeeping_staff. Also adds staff_id
-- columns to fb_staff_training and fb_staff_productivity so they can reference
-- the fb_staff roster (like HK's hk_staff_training / hk_staff_productivity).
--
-- The existing fb_staff_assignments table is kept intact for backward
-- compatibility, but the Staff Operations "Staff Assignment" sub-tab now shows
-- the fb_staff roster (like HK shows housekeeping_staff).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── fb_staff table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_staff (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  property_id     UUID,
  name            TEXT NOT NULL,
  avatar          TEXT,
  role            TEXT NOT NULL DEFAULT 'Server' CHECK (role IN (
                    'Server','Bartender','Chef','Sous Chef','Host','Busser','Manager'
                  )),
  shift           TEXT NOT NULL DEFAULT 'Morning' CHECK (shift IN (
                    'Morning','Evening','Night'
                  )),
  outlet_id       TEXT,                     -- references outlets(id)
  tables_served   INTEGER NOT NULL DEFAULT 0,
  avg_service_time_min INTEGER NOT NULL DEFAULT 0,
  inspection_score INTEGER NOT NULL DEFAULT 0,
  workload        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Active Duty',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  employee_id     TEXT,                     -- optional HR link → employees(id)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fb_staff ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fb_staff_property ON fb_staff(property_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_role ON fb_staff(role);
CREATE INDEX IF NOT EXISTS idx_fb_staff_shift ON fb_staff(shift);
CREATE INDEX IF NOT EXISTS idx_fb_staff_outlet ON fb_staff(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_employee ON fb_staff(employee_id);

-- FK to outlets
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_staff_outlet_id_fkey') THEN
    ALTER TABLE fb_staff ADD CONSTRAINT fb_staff_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_fb_staff_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_fb_staff_updated_at ON fb_staff;
CREATE TRIGGER trigger_fb_staff_updated_at
  BEFORE UPDATE ON fb_staff
  FOR EACH ROW
  EXECUTE FUNCTION update_fb_staff_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON fb_staff TO authenticated;

-- ── Add staff_id to fb_staff_training and fb_staff_productivity ──────
ALTER TABLE fb_staff_training ADD COLUMN IF NOT EXISTS staff_id TEXT;
ALTER TABLE fb_staff_productivity ADD COLUMN IF NOT EXISTS staff_id TEXT;

CREATE INDEX IF NOT EXISTS idx_fb_staff_training_staff ON fb_staff_training(staff_id);
CREATE INDEX IF NOT EXISTS idx_fb_staff_productivity_staff ON fb_staff_productivity(staff_id);

-- ── Seed fb_staff from existing F&B employees ────────────────────────
-- Outlet id map: MAIN=8f7a343f..., La Maison=8ad72723..., Sky Lounge=907e8a05..., Room Service=4a3f6574...
INSERT INTO fb_staff (id, property_id, name, avatar, role, shift, outlet_id, tables_served, avg_service_time_min, inspection_score, workload, status, is_active, employee_id)
SELECT * FROM (VALUES
  ('FB-S-01', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Marco Rossi',    'MR', 'Chef',       'Evening', '8ad72723-fb18-43b2-9333-6cc6f709f749', 0, 0, 95, 75, 'Active Duty', true, 'emp-001'),
  ('FB-S-02', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Sara Ahmed',     'SA', 'Server',     'Evening', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 12, 18, 92, 80, 'Active Duty', true, 'emp-002'),
  ('FB-S-03', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Luca Bianchi',   'LB', 'Sous Chef',  'Evening', '8ad72723-fb18-43b2-9333-6cc6f709f749', 0, 0, 90, 70, 'Active Duty', true, 'emp-003'),
  ('FB-S-04', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Ana Costa',      'AC', 'Bartender',  'Evening', '907e8a05-57f7-4159-81d3-ad53a1745fa3', 0, 0, 88, 65, 'Active Duty', true, 'emp-004'),
  ('FB-S-05', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'James Brown',    'JB', 'Host',       'Evening', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 0, 0, 85, 50, 'Active Duty', true, 'emp-005'),
  ('FB-S-06', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Yui Nakamura',   'YN', 'Server',     'Evening', '8ad72723-fb18-43b2-9333-6cc6f709f749', 10, 20, 89, 72, 'On Break',    true, 'emp-006'),
  ('FB-S-07', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Pedro Silva',    'PS', 'Busser',     'Morning', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 8, 15, 87, 55, 'Active Duty', true, 'emp-007')
) AS v(id, property_id, name, avatar, role, shift, outlet_id, tables_served, avg_service_time_min, inspection_score, workload, status, is_active, employee_id)
WHERE NOT EXISTS (SELECT 1 FROM fb_staff s WHERE s.id = v.id);

-- ── Backfill staff_id on existing training/productivity rows ─────────
UPDATE fb_staff_training t
  SET staff_id = s.id
  FROM fb_staff s
  WHERE t.employee_id = s.employee_id
    AND t.staff_id IS NULL;

UPDATE fb_staff_productivity p
  SET staff_id = s.id
  FROM fb_staff s
  WHERE p.employee_id = s.employee_id
    AND p.staff_id IS NULL;
