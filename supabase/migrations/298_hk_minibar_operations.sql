-- Migration: Housekeeping Minibar Operations
-- Adds the tables backing the Minibar Operations module
-- (docs/Housekeeping Portal new.md §15) and seeds the mock room minibar
-- state that was previously hardcoded in MinibarOperationsModule.tsx.
--
-- Two tables:
--   hk_minibar_room — one row per room minibar with status, floor, posted
--                     flag, total charge, and missing-items list.
--   hk_minibar_item — line items consumed from a room's minibar
--                     (name, qty, price).
--
-- Routes:
--   GET  /api/hk-portal/minibar/:propertyId
--   POST /api/hk-portal/minibar/:id/refill
--   POST /api/hk-portal/minibar/:id/record
--   POST /api/hk-portal/minibar/:id/verify
--   POST /api/hk-portal/minibar/:id/post-charge

CREATE TABLE IF NOT EXISTS hk_minibar_room (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  room          TEXT NOT NULL,
  floor         INTEGER NOT NULL DEFAULT 1 CHECK (floor >= 0),
  status        TEXT NOT NULL DEFAULT 'Pending Refill' CHECK (status IN (
                  'Pending Refill', 'Refilled', 'Consumption Recorded',
                  'Stock Verified', 'Charge Posted', 'Missing Items'
                )),
  posted        BOOLEAN NOT NULL DEFAULT FALSE,
  total_charge  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_charge >= 0),
  missing_items TEXT[] NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, room)
);

CREATE INDEX IF NOT EXISTS idx_hk_minibar_room_property
  ON hk_minibar_room(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_minibar_room_status
  ON hk_minibar_room(status);

CREATE OR REPLACE FUNCTION update_hk_minibar_room_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_minibar_room_updated_at ON hk_minibar_room;
CREATE TRIGGER trigger_hk_minibar_room_updated_at
  BEFORE UPDATE ON hk_minibar_room
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_minibar_room_timestamp();

CREATE TABLE IF NOT EXISTS hk_minibar_item (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       TEXT NOT NULL REFERENCES hk_minibar_room(id) ON DELETE CASCADE,
  property_id   UUID,
  name          TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  price         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_minibar_item_room
  ON hk_minibar_item(room_id);
CREATE INDEX IF NOT EXISTS idx_hk_minibar_item_property
  ON hk_minibar_item(property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_minibar_room TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hk_minibar_item TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- Uses the single demo property (matches other HK seed migrations).
-- Room state mirrors the seed array in MinibarOperationsModule.tsx.
INSERT INTO hk_minibar_room (id, property_id, room, floor, status, posted, total_charge, missing_items)
VALUES
  ('MB-7001', '18762279-a389-41c9-9169-7ebc682e9703', '101', 1, 'Pending Refill',        FALSE, 14.00, '{}'),
  ('MB-7002', '18762279-a389-41c9-9169-7ebc682e9703', '204', 2, 'Consumption Recorded',  FALSE, 24.00, '{}'),
  ('MB-7003', '18762279-a389-41c9-9169-7ebc682e9703', '305', 3, 'Missing Items',         FALSE, 22.00, '{"Chocolate Bar","Juice"}'),
  ('MB-7004', '18762279-a389-41c9-9169-7ebc682e9703', '410', 4, 'Stock Verified',        FALSE,  0.00, '{}'),
  ('MB-7005', '18762279-a389-41c9-9169-7ebc682e9703', '502', 5, 'Charge Posted',         TRUE,  45.00, '{}')
ON CONFLICT (id) DO NOTHING;

-- Consumed line items mirror the consumedItems arrays in the seed.
INSERT INTO hk_minibar_item (room_id, property_id, name, qty, price)
VALUES
  ('MB-7001', '18762279-a389-41c9-9169-7ebc682e9703', 'Sparkling Water', 2, 5.00),
  ('MB-7001', '18762279-a389-41c9-9169-7ebc682e9703', 'Soda',            1, 4.00),
  ('MB-7002', '18762279-a389-41c9-9169-7ebc682e9703', 'Red Wine',        1, 18.00),
  ('MB-7002', '18762279-a389-41c9-9169-7ebc682e9703', 'Chips',           1, 6.00),
  ('MB-7003', '18762279-a389-41c9-9169-7ebc682e9703', 'Whiskey',         1, 22.00),
  ('MB-7005', '18762279-a389-41c9-9169-7ebc682e9703', 'Champagne',       1, 45.00)
ON CONFLICT DO NOTHING;
