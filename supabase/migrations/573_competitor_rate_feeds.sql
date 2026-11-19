-- ============================================================================
-- Migration: 573_competitor_rate_feeds.sql
-- ----------------------------------------------------------------------------
-- Audit item 3.6 — competitor rate refresh fabricates data.
--
-- 1. rms_competitors.feed_config: per-competitor rate-feed configuration used
--    by the refresh adapter (endpoint, auth, field_map, timeout, mode).
--    mode='simulated' marks a demo competitor — its refresh writes rows with
--    source='simulated' and the API reports simulated=true.
-- 2. rms_competitors.last_rate_error: persists the last failed pull so the UI
--    can surface it instead of pretending the refresh succeeded.
-- 3. Seed rms_competitor_rates were written with source='api' although they
--    are fabricated demo rows (Hotel A/B/C at hotela.com). Relabel them
--    'seed' so nothing downstream treats them as a real market pull.
-- ============================================================================

ALTER TABLE rms_competitors ADD COLUMN IF NOT EXISTS feed_config JSONB;
ALTER TABLE rms_competitors ADD COLUMN IF NOT EXISTS last_rate_error TIMESTAMPTZ;

COMMENT ON COLUMN rms_competitors.feed_config IS
  'Rate-feed config consumed by the refresh adapter. Keys: endpoint, method, headers, auth {type:bearer|basic|apikey,token,username,password,api_key,api_key_header}, timeout_ms, rates_path (dot-path to the rates array), field_map {room_type,rate,rate_date,currency,availability}, mode (live|simulated).';

-- The source CHECK only allowed 'api'/'manual' — the refresh endpoint's
-- 'simulated' writes were actually violating it. Widen for the honest
-- vocabulary: feed (real pull), manual, simulated (demo mode), seed.
ALTER TABLE rms_competitor_rates DROP CONSTRAINT IF EXISTS rms_competitor_rates_source_check;
ALTER TABLE rms_competitor_rates ADD CONSTRAINT rms_competitor_rates_source_check
  CHECK (source = ANY (ARRAY['feed','api','manual','simulated','seed']));

-- Seed/demo rates were labeled 'api' — they were never fetched from anywhere.
UPDATE rms_competitor_rates SET source = 'seed' WHERE source = 'api';

-- The bundled demo competitors have no real feed; mark them simulated so the
-- refresh button produces honestly-labeled demo data instead of a fake pull.
UPDATE rms_competitors
   SET feed_config = COALESCE(feed_config, '{}'::jsonb) || '{"mode":"simulated"}'::jsonb
 WHERE website LIKE 'https://hotel%.com'
   AND (feed_config IS NULL OR feed_config->>'mode' IS NULL);
