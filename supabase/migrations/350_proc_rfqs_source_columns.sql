-- 350_proc_rfqs_source_columns.sql
-- Adds source_system and source_ref columns to proc_rfqs so that RFQs created
-- from department requisitions (Engineering, Housekeeping, F&B) can be tracked
-- back to their originating requisition/department.

ALTER TABLE public.proc_rfqs
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_proc_rfqs_source_system
  ON public.proc_rfqs(source_system);

-- Backfill existing RFQs as 'procurement' (manually created).
UPDATE public.proc_rfqs
SET source_system = 'procurement'
WHERE source_system IS NULL;

COMMENT ON COLUMN public.proc_rfqs.source_system IS
  'Originating system: procurement (manual), engineering, housekeeping, food_beverage';
COMMENT ON COLUMN public.proc_rfqs.source_ref IS
  'ID of the originating record (e.g. proc_requisitions.id)';
