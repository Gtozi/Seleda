-- Migration: Housekeeping Property Setup & Configuration
-- Backs the Configuration module (docs/Housekeeping Portal new.md §24).
--
-- Two concerns:
--   1. Property Setup — buildings, floors, zones, public areas (was entirely
--      missing from the Configuration module). Stored in hk_property_setup.
--   2. Section config — status codes, cleaning priorities, inspection rules,
--      task types, service levels, cleaning standards, teams, shifts, skills,
--      certifications. Stored as JSON blobs in hk_config keyed by section.

-- ── Property Setup ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hk_property_setup (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('building','floor','zone','public_area')),
  name        TEXT NOT NULL,
  parent_id   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_prop_setup_property ON hk_property_setup(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_prop_setup_type ON hk_property_setup(entity_type);

CREATE OR REPLACE FUNCTION hk_prop_setup_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hk_prop_setup_updated_at ON hk_property_setup;
CREATE TRIGGER trg_hk_prop_setup_updated_at
  BEFORE UPDATE ON hk_property_setup
  FOR EACH ROW EXECUTE FUNCTION hk_prop_setup_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_property_setup TO authenticated;

-- ── Section Config (JSON key-value per property per section) ────────────
CREATE TABLE IF NOT EXISTS hk_config (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  section     TEXT NOT NULL CHECK (section IN (
                'room_status','task','staff','docs','consumption'
              )),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hk_config_property_section
  ON hk_config(property_id, section);

CREATE OR REPLACE FUNCTION hk_config_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hk_config_updated_at ON hk_config;
CREATE TRIGGER trg_hk_config_updated_at
  BEFORE UPDATE ON hk_config
  FOR EACH ROW EXECUTE FUNCTION hk_config_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_config TO authenticated;

-- ── Seed public areas (docs §8) for the demo property ──────────────────
INSERT INTO hk_property_setup (id, property_id, entity_type, name, sort_order)
SELECT * FROM (VALUES
  ('hk-pa-lobby'::text,       '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Lobby'::text,          1),
  ('hk-pa-reception'::text,   '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Reception'::text,      2),
  ('hk-pa-corridors'::text,   '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Corridors'::text,      3),
  ('hk-pa-elevators'::text,   '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Elevators'::text,      4),
  ('hk-pa-restrooms'::text,   '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Restrooms'::text,      5),
  ('hk-pa-meeting'::text,     '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Meeting Rooms'::text,  6),
  ('hk-pa-restaurants'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Restaurants'::text,    7),
  ('hk-pa-bars'::text,        '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Bars'::text,           8),
  ('hk-pa-pool'::text,        '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Pool Area'::text,      9),
  ('hk-pa-spa'::text,         '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Spa'::text,           10),
  ('hk-pa-fitness'::text,     '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Fitness Center'::text,11),
  ('hk-pa-parking'::text,     '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Parking Areas'::text, 12),
  ('hk-pa-staff'::text,       '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Staff Areas'::text,   13),
  ('hk-pa-offices'::text,     '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'public_area'::text, 'Offices'::text,       14)
) AS t(id, property_id, entity_type, name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM hk_property_setup WHERE id = t.id);
