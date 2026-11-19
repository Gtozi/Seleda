-- 352_proc_tenders_source_columns.sql
-- Adds source_system and source_ref columns to proc_tenders so that tenders
-- created from department requisitions can be tracked back to their origin.

ALTER TABLE public.proc_tenders
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_proc_tenders_source_system
  ON public.proc_tenders(source_system);

UPDATE public.proc_tenders
SET source_system = 'procurement'
WHERE source_system IS NULL;

COMMENT ON COLUMN public.proc_tenders.source_system IS
  'Originating system: procurement (manual), engineering, housekeeping, food_beverage';
COMMENT ON COLUMN public.proc_tenders.source_ref IS
  'ID of the originating record (e.g. proc_requisitions.id)';
