-- Migration: Fix housekeeping_task_mgmt started_at / completed_at columns
--
-- Problem: migration 278 added started_at and completed_at as TEXT, and the
-- backend wrote time-only labels ("09:41 AM") via nowTimeLabel(). This made
-- date-based bucketing (e.g. the 7-day productivity trend) permanently zero
-- because "09:41 AM".split('T')[0] never matches a date string.
--
-- Fix: convert both columns to TIMESTAMPTZ. Existing text values are not
-- valid timestamps, so they are discarded (set to NULL) during the conversion.
-- The backend now writes full ISO 8601 timestamps.

ALTER TABLE housekeeping_task_mgmt
  ALTER COLUMN started_at TYPE TIMESTAMPTZ USING NULL;

ALTER TABLE housekeeping_task_mgmt
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING NULL;

-- Backfill completed_at for rows already in Completed/Verified status so the
-- productivity trend isn't empty until new tasks complete. Use updated_at as
-- the best available proxy (it's a real timestamptz set on every status change).
UPDATE housekeeping_task_mgmt
  SET completed_at = updated_at
  WHERE completed_at IS NULL
    AND status IN ('Completed', 'Verified')
    AND updated_at IS NOT NULL;
