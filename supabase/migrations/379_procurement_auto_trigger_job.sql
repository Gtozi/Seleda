-- ════════════════════════════════════════════════════════════════
-- Migration 379: Seed scheduled job for procurement auto-trigger
-- Scans Main Warehouse for items at/below reorder point and
-- auto-generates procurement requisitions every 2 hours.
-- ════════════════════════════════════════════════════════════════

-- Use a fixed UUID for idempotency
INSERT INTO public.scheduled_jobs (id, name, type, schedule_cron, config, enabled)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Procurement Auto-Trigger (Low Central Stock)',
  'procurement_auto_trigger',
  '0 */2 * * *',
  '{}'::jsonb,
  true
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    type = EXCLUDED.type,
    schedule_cron = EXCLUDED.schedule_cron,
    config = EXCLUDED.config,
    enabled = EXCLUDED.enabled;

DO $$
BEGIN
  RAISE NOTICE 'Migration 379 complete: procurement_auto_trigger scheduled job seeded (every 2 hours).';
END $$;
