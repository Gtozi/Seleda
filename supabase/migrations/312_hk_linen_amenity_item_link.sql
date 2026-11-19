-- Migration 312: Explicit linen/amenity → inventory_items linkage
--
-- Problem: adjustHkStore() resolves the central inventory row by
-- case-insensitive name + property. In practice the operational labels
-- ("Soap", "Bed Sheets") and the inventory item names ("Soap Bars",
-- "King/Queen Size Sheets") use different conventions, so only 3 of 22
-- types resolve and the rest silently no-op (Fix 6) or created phantom
-- rows (pre-Fix 6).
--
-- Fix: add an explicit `inventory_item_id` column to the linen and amenity
-- stock tables. When set, the operation handlers pass it through to
-- adjustHkStore() via opts.itemId, bypassing name matching entirely.
-- When NULL, the name fallback still runs (and now surfaces a warning).
--
-- The column is TEXT to match inventory_items.id (which is TEXT in this
-- project). Nullable because linkage is opt-in per type — an unlinked type
-- still works operationally, it just won't move the central ledger.

ALTER TABLE hk_linen_stock
  ADD COLUMN IF NOT EXISTS inventory_item_id TEXT
  REFERENCES inventory_items(id) ON DELETE SET NULL;

ALTER TABLE hk_amenity_stock
  ADD COLUMN IF NOT EXISTS inventory_item_id TEXT
  REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hk_linen_stock_inv_item
  ON hk_linen_stock(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hk_amenity_stock_inv_item
  ON hk_amenity_stock(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

-- Best-effort auto-link: where the names already match exactly (case-
-- insensitive), populate the linkage so the existing 3 matched types
-- (Bath Towels, Hand Towels, Pillowcases) and any future exact matches
-- work without manual setup.
UPDATE hk_linen_stock s
SET inventory_item_id = i.id
FROM inventory_items i
WHERE i.name ILIKE s.type
  AND i.property_id = s.property_id::text
  AND s.inventory_item_id IS NULL;

UPDATE hk_amenity_stock a
SET inventory_item_id = i.id
FROM inventory_items i
WHERE i.name ILIKE a.type
  AND i.property_id = a.property_id::text
  AND a.inventory_item_id IS NULL;
