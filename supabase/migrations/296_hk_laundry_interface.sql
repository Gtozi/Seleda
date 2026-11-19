-- Migration: Housekeeping Laundry Interface
-- Adds the table backing the Laundry Interface module
-- (docs/Housekeeping Portal new.md §13) and seeds the mock laundry jobs
-- that were previously hardcoded in LaundryModule.tsx.
--
-- Tracks the wash/dry/iron production cycle for Guest / Uniform / Linen
-- laundry. Distinct from Linen Management (§12) which tracks stock levels.
--
-- Status flow: Pickup Requested → Collected → Washing → Drying → Ironing
--              → Ready → Delivered

CREATE TABLE IF NOT EXISTS hk_laundry_jobs (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  category      TEXT NOT NULL CHECK (category IN ('Guest', 'Uniform', 'Linen')),
  service_type  TEXT NOT NULL CHECK (service_type IN (
                  'Wash', 'Dry Clean', 'Iron', 'Express Service'
                )),
  pieces        INTEGER NOT NULL DEFAULT 0 CHECK (pieces >= 0),
  status        TEXT NOT NULL DEFAULT 'Pickup Requested' CHECK (status IN (
                  'Pickup Requested', 'Collected', 'Washing', 'Drying',
                  'Ironing', 'Ready', 'Delivered'
                )),
  guest_name    TEXT,
  room_number   TEXT,
  staff         TEXT,
  requested_at  TEXT,
  eta           TEXT,
  exception     TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_laundry_jobs_property
  ON hk_laundry_jobs(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_jobs_status
  ON hk_laundry_jobs(status);
CREATE INDEX IF NOT EXISTS idx_hk_laundry_jobs_category
  ON hk_laundry_jobs(category);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_laundry_jobs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_laundry_jobs_updated_at ON hk_laundry_jobs;
CREATE TRIGGER trigger_hk_laundry_jobs_updated_at
  BEFORE UPDATE ON hk_laundry_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_laundry_jobs_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_laundry_jobs TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Uses the single demo property (matches other HK seed migrations).
-- Values mirror the seed array in LaundryModule.tsx.
INSERT INTO hk_laundry_jobs (id, property_id, category, service_type, pieces, status, guest_name, room_number, staff, requested_at, eta, exception)
VALUES
  ('LA-5001', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest',   'Express Service',   5, 'Washing',          'J. Smith',          '204', NULL,                '08:00 AM', '11:00 AM', NULL),
  ('LA-5002', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest',   'Wash',              8, 'Ready',            'A. Khan',           '305', NULL,                '07:30 AM', '10:30 AM', NULL),
  ('LA-5003', '18762279-a389-41c9-9169-7ebc682e9703', 'Uniform', 'Wash',             12, 'Ironing',          NULL,                NULL,  'Housekeeping Team', '06:00 AM', '09:00 AM', NULL),
  ('LA-5004', '18762279-a389-41c9-9169-7ebc682e9703', 'Linen',   'Wash',            120, 'Drying',           NULL,                NULL,  'Linen Room',        '05:30 AM', '08:30 AM', NULL),
  ('LA-5005', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest',   'Dry Clean',         3, 'Pickup Requested', 'M. Lee',            '502', NULL,                '09:15 AM', NULL,        'Express surcharge pending approval'),
  ('LA-5006', '18762279-a389-41c9-9169-7ebc682e9703', 'Linen',   'Wash',             60, 'Delivered',        NULL,                NULL,  'Linen Room',        '04:00 AM', '07:00 AM', NULL),
  ('LA-5007', '18762279-a389-41c9-9169-7ebc682e9703', 'Uniform', 'Iron',              6, 'Collected',        NULL,                NULL,  'F&B Team',          '09:00 AM', NULL,        'Missing name tags on 2 items')
ON CONFLICT (id) DO NOTHING;
