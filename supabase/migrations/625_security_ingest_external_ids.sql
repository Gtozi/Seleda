-- ============================================================================
-- 625_security_ingest_external_ids.sql — lineage/dedup columns for hardware
-- ingestion into sec_alarms and sec_access_events.
-- ============================================================================
-- The /api/sec-portal/ingest/* endpoints let access-control panels and alarm
-- gateways push events using an API key (api_keys table, scope
-- 'security:ingest'). Two nullable columns are added to each table:
--
--   source      — which external system produced the row (defaults to the
--                 API key's name, e.g. 'Lenel OnGuard', 'Fire Panel GW-01')
--   external_id — the source system's own event/alarm id. Combined with
--                 source it gives idempotent ingestion: retries of the same
--                 upstream event are skipped instead of duplicated.
--
-- A partial UNIQUE index on (source, external_id) enforces dedup at the
-- database level; the route additionally pre-filters known ids so batches
-- report accurate inserted/skipped counts.
-- ============================================================================

ALTER TABLE public.sec_alarms
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

ALTER TABLE public.sec_access_events
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_alarms_external
  ON public.sec_alarms (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_access_events_external
  ON public.sec_access_events (source, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON COLUMN public.sec_alarms.source IS 'External system that pushed this alarm (set by /ingest/alarms)';
COMMENT ON COLUMN public.sec_alarms.external_id IS 'Upstream event id for idempotent ingestion (set by /ingest/alarms)';
COMMENT ON COLUMN public.sec_access_events.source IS 'External system that pushed this event (set by /ingest/access-events)';
COMMENT ON COLUMN public.sec_access_events.external_id IS 'Upstream event id for idempotent ingestion (set by /ingest/access-events)';

-- END: 625_security_ingest_external_ids.sql
