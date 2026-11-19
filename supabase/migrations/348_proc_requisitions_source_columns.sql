-- 348_proc_requisitions_source_columns.sql
-- Adds source_system and source_ref columns to proc_requisitions so that
-- requisitions created from department portals (Engineering, Housekeeping, F&B)
-- can be tracked back to their originating silo record.
-- This enables the unified Procurement portal to show department-originated
-- requisitions alongside those created directly in the Procurement portal.

ALTER TABLE public.proc_requisitions
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_proc_requisitions_source_system
  ON public.proc_requisitions(source_system);

-- Backfill existing procurement-portal-created requisitions as 'procurement'.
UPDATE public.proc_requisitions
SET source_system = 'procurement'
WHERE source_system IS NULL;

COMMENT ON COLUMN public.proc_requisitions.source_system IS
  'Originating system: procurement (direct), engineering, housekeeping, food_beverage, inventory';
COMMENT ON COLUMN public.proc_requisitions.source_ref IS
  'ID of the originating record in the source system (e.g. eng_purchase_orders.id)';
