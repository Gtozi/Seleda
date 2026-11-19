-- Migration: Housekeeping Minibar Inventory (Catalog + Per-Room Stock)
-- Adds a master item catalog and per-room stock tracking with par levels.
--
-- Two new tables:
--   hk_minibar_catalog  — master list of minibar items with default price
--                          and par level (target stock per room).
--   hk_minibar_inventory — per-room stock levels keyed by (room_id, catalog_id).
--
-- Flow:
--   • Room created  → inventory auto-populated from active catalog at par_level
--   • Refill action → inventory reset to par_level for all catalog items
--   • Consumption   → qty deducted from inventory, consumed item recorded for charging
--   • Low stock     → qty < par_level highlighted in UI

CREATE TABLE IF NOT EXISTS hk_minibar_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID,
  name          TEXT NOT NULL,
  price         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  par_level     INTEGER NOT NULL DEFAULT 2 CHECK (par_level >= 0),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, name)
);

CREATE INDEX IF NOT EXISTS idx_hk_minibar_catalog_property
  ON hk_minibar_catalog(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_minibar_catalog_active
  ON hk_minibar_catalog(active);

CREATE TABLE IF NOT EXISTS hk_minibar_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       TEXT NOT NULL REFERENCES hk_minibar_room(id) ON DELETE CASCADE,
  catalog_id    UUID NOT NULL REFERENCES hk_minibar_catalog(id) ON DELETE CASCADE,
  property_id   UUID,
  qty           INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_hk_minibar_inventory_room
  ON hk_minibar_inventory(room_id);
CREATE INDEX IF NOT EXISTS idx_hk_minibar_inventory_property
  ON hk_minibar_inventory(property_id);

CREATE OR REPLACE FUNCTION update_hk_minibar_inventory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_minibar_inventory_updated_at ON hk_minibar_inventory;
CREATE TRIGGER trigger_hk_minibar_inventory_updated_at
  BEFORE UPDATE ON hk_minibar_inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_minibar_inventory_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_minibar_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hk_minibar_inventory TO authenticated;

-- ── Seed catalog for the demo property ───────────────────────────────────
INSERT INTO hk_minibar_catalog (property_id, name, price, par_level, active)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Sparkling Water', 5.00,  3, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Soda',            4.00,  3, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Orange Juice',    6.00,  2, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Beer',            8.00,  2, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Red Wine',       18.00,  1, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Champagne',      45.00,  1, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Whiskey',        22.00,  1, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Chocolate Bar',   3.50,  3, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Chips',           6.00,  2, TRUE),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Mixed Nuts',      5.50,  2, TRUE)
ON CONFLICT (property_id, name) DO NOTHING;

-- ── Backfill inventory for existing rooms at par_level ───────────────────
-- Each existing minibar room gets all active catalog items at par_level,
-- minus any already-consumed items (matched by name).
INSERT INTO hk_minibar_inventory (room_id, catalog_id, property_id, qty)
SELECT
  r.id,
  c.id,
  r.property_id,
  GREATEST(0, c.par_level - COALESCE(consumed.total_consumed, 0))
FROM hk_minibar_room r
CROSS JOIN hk_minibar_catalog c
LEFT JOIN (
  SELECT room_id, name, SUM(qty) AS total_consumed
  FROM hk_minibar_item
  GROUP BY room_id, name
) consumed ON consumed.room_id = r.id AND consumed.name = c.name
WHERE c.active = TRUE
ON CONFLICT (room_id, catalog_id) DO NOTHING;
