-- Seed the "Finance Dashboard Snapshot" scheduled job.
-- This job aggregates KPIs from journal_entries, gl_invoices, and
-- usali_chart_of_accounts and upserts the result into
-- fin_dashboard_snapshots so /erp/finance/dashboard has fresh data.
--
-- Also adds the missing ap_aging column to fin_dashboard_snapshots
-- (the original migration 408 only included ar_aging).
--
-- Runs every 2 hours — frequent enough for near-real-time dashboards
-- without overloading the database.

BEGIN;

-- Add ap_aging column if it doesn't exist (matches the frontend type)
ALTER TABLE fin_dashboard_snapshots
  ADD COLUMN IF NOT EXISTS ap_aging JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
VALUES (
  'Finance Dashboard Snapshot',
  'finance_dashboard_snapshot',
  '0 */2 * * *',
  '{}'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

COMMIT;
