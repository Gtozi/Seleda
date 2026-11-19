-- RMS reports: decouple data generators from report row IDs.
--
-- Previously GET /reports/:id/data and POST /reports/:id/run looked up
-- RMS_REPORT_GENERATORS[req.params.id], hard-binding generation to the
-- global seed IDs ('rms-daily-revenue', ...). Any per-property or custom
-- report row could never resolve a generator.
--
-- `generator_key` lets each report row declare which generator produces its
-- data. Seed rows backfill to their own id (which already doubles as the
-- generator key), so existing lookups keep working. Per-property reports can
-- reuse a generator (e.g. generator_key = 'rms-daily-revenue') under their
-- own id.

ALTER TABLE public.rms_reports
  ADD COLUMN IF NOT EXISTS generator_key TEXT;

COMMENT ON COLUMN public.rms_reports.generator_key IS
  'Key into the backend RMS_REPORT_GENERATORS registry. NULL falls back to the row id for backward compatibility.';

UPDATE public.rms_reports
SET generator_key = id
WHERE generator_key IS NULL;
