-- Concierge portal gap fix (#3/#4): route guest and concierge restaurant
-- bookings into the real F&B reservation book instead of nonexistent
-- restaurants/restaurant_reservations tables.
--
-- A concierge- or guest-placed booking has no table assigned yet (the host
-- assigns one at seating), so table_id must be nullable and the row needs
-- its own outlet + provenance columns.

ALTER TABLE fb_table_reservations ALTER COLUMN table_id DROP NOT NULL;

ALTER TABLE fb_table_reservations
  ADD COLUMN IF NOT EXISTS outlet_id TEXT REFERENCES outlets(id),
  ADD COLUMN IF NOT EXISTS booked_via TEXT NOT NULL DEFAULT 'fnb'
    CHECK (booked_via IN ('fnb', 'concierge', 'guest'));

-- Backfill outlet for rows created before this column existed.
UPDATE fb_table_reservations r
SET outlet_id = t.outlet_id
FROM fb_tables t
WHERE r.table_id = t.id AND r.outlet_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fb_table_reservations_outlet
  ON fb_table_reservations(outlet_id);
