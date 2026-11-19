-- Migration: convert relative-text status timestamps to real TIMESTAMPTZ columns
-- and refresh demo rows so they are sortable and queryable.

-- rms_distribution_channels.last_sync
UPDATE rms_distribution_channels
SET last_sync = NULL
WHERE last_sync IS NOT NULL AND last_sync !~ '^\d{4}-\d{2}-\d{2}';

ALTER TABLE rms_distribution_channels
  ALTER COLUMN last_sync TYPE TIMESTAMPTZ USING last_sync::timestamptz;

CREATE INDEX IF NOT EXISTS idx_rms_dist_channels_last_sync
  ON rms_distribution_channels(last_sync);

UPDATE rms_distribution_channels
SET last_sync = NOW() - INTERVAL '10 minutes'
WHERE last_sync IS NULL;

-- rms_sync_schedule.last_run / next_run
UPDATE rms_sync_schedule
SET last_run = NULL
WHERE last_run IS NOT NULL AND last_run !~ '^\d{4}-\d{2}-\d{2}';

UPDATE rms_sync_schedule
SET next_run = NULL
WHERE next_run IS NOT NULL AND next_run !~ '^\d{4}-\d{2}-\d{2}';

ALTER TABLE rms_sync_schedule
  ALTER COLUMN last_run TYPE TIMESTAMPTZ USING last_run::timestamptz,
  ALTER COLUMN next_run TYPE TIMESTAMPTZ USING next_run::timestamptz;

CREATE INDEX IF NOT EXISTS idx_rms_sync_schedule_last_run
  ON rms_sync_schedule(last_run);

CREATE INDEX IF NOT EXISTS idx_rms_sync_schedule_next_run
  ON rms_sync_schedule(next_run);

UPDATE rms_sync_schedule
SET last_run = NOW() - INTERVAL '10 minutes',
    next_run = NOW() + INTERVAL '1 minute'
WHERE last_run IS NULL AND next_run IS NULL;
