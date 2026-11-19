-- Concierge portal gap fix (#9): give the seeded concierge_settings rows real
-- consumers.
--
--   1. vendors.rating — vendors.min-rating flags concierge vendors below the
--      threshold in GET /api/concierge/vendors and the dashboard alerts.
--      The vendors table is shared with Accounts Payable; the column is
--      nullable so AP rows are unaffected.
--   2. scheduled_jobs — registers the Concierge Daily Digest job. It runs
--      every 15 minutes and fires once per day inside the 15-minute bucket
--      starting at notifications.daily-digest's configured time.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS rating numeric(3,1)
    CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5));

INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
SELECT 'Concierge Daily Digest', 'concierge_daily_digest', '*/15 * * * *', '{}', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_jobs WHERE type = 'concierge_daily_digest'
);
