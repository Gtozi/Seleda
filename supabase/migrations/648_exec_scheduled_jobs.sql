-- Executive Portal — scheduled jobs for reporting pipeline
-- Registers the two exec job handlers implemented in
-- src/server/services/execReporting.ts (handlers registered in
-- src/server/scheduler.ts).

-- Daily 06:05: write reporting_snapshots + metric_history and evaluate
-- alert_rules into alert_instances.
INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
VALUES (
  'Executive Reporting Snapshot',
  'exec_reporting_snapshot',
  '5 6 * * *',
  '{}'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

-- Hourly: dispatch due report_schedules to their recipient_list.
INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
VALUES (
  'Executive Report Dispatch',
  'exec_report_dispatch',
  '7 * * * *',
  '{}'::jsonb,
  true
)
ON CONFLICT DO NOTHING;
