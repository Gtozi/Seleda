-- Migration: Housekeeping Minibar Operations — Audit Log
-- Adds hk_minibar_log to track all minibar status changes, item additions,
-- missing-item updates, and charge postings. Backs the operation history
-- panel in the Minibar Operations module.
--
-- Depends on: 298_hk_minibar_operations.sql (hk_minibar_room)

CREATE TABLE IF NOT EXISTS hk_minibar_log (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  room_id       TEXT REFERENCES hk_minibar_room(id) ON DELETE CASCADE,
  room          TEXT,
  action        TEXT NOT NULL CHECK (action IN (
                  'Created', 'Refill', 'Consumption Recorded', 'Stock Verified',
                  'Charge Posted', 'Item Added', 'Item Removed',
                  'Missing Items Set', 'Missing Items Cleared'
                )),
  detail        TEXT,
  staff         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_minibar_log_property
  ON hk_minibar_log(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_minibar_log_room
  ON hk_minibar_log(room_id);
CREATE INDEX IF NOT EXISTS idx_hk_minibar_log_created_at
  ON hk_minibar_log(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_minibar_log TO authenticated;
