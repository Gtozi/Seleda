-- Migration: Housekeeping Amenities Management
-- Adds the tables backing the Amenities Management module
-- (docs/Housekeeping Portal new.md §14) and seeds the mock stock + log
-- entries that were previously hardcoded in GuestAmenitiesModule.tsx.
--
-- Two tables:
--   hk_amenity_stock — one row per amenity type (12 types) with par,
--                      in_stock, consumed_today counters.
--   hk_amenity_log   — append-only consumption / replenishment log.
--
-- The POST /api/hk-portal/amenities/consume route decrements in_stock,
-- increments consumed_today, and inserts a log row.
-- The POST /api/hk-portal/amenities/replenish route resets in_stock to par
-- and inserts a replenishment log row.

CREATE TABLE IF NOT EXISTS hk_amenity_stock (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
                  'Soap', 'Shampoo', 'Conditioner', 'Body Wash', 'Lotion',
                  'Toothbrush Kit', 'Shaving Kit', 'Sewing Kit', 'Slippers',
                  'Water Bottles', 'Tea & Coffee', 'Stationery'
                )),
  par           INTEGER NOT NULL DEFAULT 0 CHECK (par >= 0),
  in_stock      INTEGER NOT NULL DEFAULT 0 CHECK (in_stock >= 0),
  consumed_today INTEGER NOT NULL DEFAULT 0 CHECK (consumed_today >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, type)
);

CREATE INDEX IF NOT EXISTS idx_hk_amenity_stock_property
  ON hk_amenity_stock(property_id);

CREATE OR REPLACE FUNCTION update_hk_amenity_stock_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_amenity_stock_updated_at ON hk_amenity_stock;
CREATE TRIGGER trigger_hk_amenity_stock_updated_at
  BEFORE UPDATE ON hk_amenity_stock
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_amenity_stock_timestamp();

CREATE TABLE IF NOT EXISTS hk_amenity_log (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  action        TEXT NOT NULL CHECK (action IN ('Consumption', 'Replenishment')),
  type          TEXT NOT NULL CHECK (type IN (
                  'Soap', 'Shampoo', 'Conditioner', 'Body Wash', 'Lotion',
                  'Toothbrush Kit', 'Shaving Kit', 'Sewing Kit', 'Slippers',
                  'Water Bottles', 'Tea & Coffee', 'Stationery'
                )),
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  room          TEXT,
  staff         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_amenity_log_property
  ON hk_amenity_log(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_amenity_log_created_at
  ON hk_amenity_log(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_amenity_stock TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hk_amenity_log TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Uses the single demo property (matches other HK seed migrations).
-- Stock values mirror the STOCK array in GuestAmenitiesModule.tsx.
INSERT INTO hk_amenity_stock (property_id, type, par, in_stock, consumed_today)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Soap',            200, 140, 18),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Shampoo',         200,  90, 22),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Conditioner',     150, 110, 12),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Body Wash',       150,  95, 14),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Lotion',          120,  80,  8),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Toothbrush Kit',  100,  60, 10),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Shaving Kit',      80,  55,  6),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Sewing Kit',       60,  48,  3),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Slippers',        100,  35, 15),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Water Bottles',   300, 180, 45),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Tea & Coffee',    200, 130, 28),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Stationery',       80,  70,  4)
ON CONFLICT (property_id, type) DO NOTHING;

-- Log entries mirror the seedLog array in GuestAmenitiesModule.tsx.
INSERT INTO hk_amenity_log (id, property_id, action, type, quantity, room, staff, created_at)
VALUES
  ('AM-6001', '18762279-a389-41c9-9169-7ebc682e9703', 'Consumption', 'Water Bottles', 4, '204', 'James L.',  NOW() - INTERVAL '3 hours'),
  ('AM-6002', '18762279-a389-41c9-9169-7ebc682e9703', 'Consumption', 'Soap',          2, '101', 'Maria S.',  NOW() - INTERVAL '3 hours 30 minutes'),
  ('AM-6003', '18762279-a389-41c9-9169-7ebc682e9703', 'Consumption', 'Slippers',      2, '502', 'Priya K.',  NOW() - INTERVAL '2 hours 30 minutes'),
  ('AM-6004', '18762279-a389-41c9-9169-7ebc682e9703', 'Consumption', 'Tea & Coffee',  2, '305', 'Carlos M.', NOW() - INTERVAL '2 hours 45 minutes')
ON CONFLICT (id) DO NOTHING;
