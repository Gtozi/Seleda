-- 349_proc_demand_forecasts_source_columns.sql
-- Adds source_system and source_ref columns to proc_demand_forecasts so that
-- demand signals synced from department silos (Engineering spare parts,
-- Housekeeping linen/amenity stock, F&B ingredient forecasts) can be tracked
-- back to their originating record.

ALTER TABLE public.proc_demand_forecasts
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_proc_demand_forecasts_source_system
  ON public.proc_demand_forecasts(source_system);

-- Backfill existing forecasts as 'procurement' (manually created).
UPDATE public.proc_demand_forecasts
SET source_system = 'procurement'
WHERE source_system IS NULL;

COMMENT ON COLUMN public.proc_demand_forecasts.source_system IS
  'Originating system: procurement (manual), engineering, housekeeping, food_beverage';
COMMENT ON COLUMN public.proc_demand_forecasts.source_ref IS
  'ID of the originating record in the source system (e.g. spare_parts.id)';
