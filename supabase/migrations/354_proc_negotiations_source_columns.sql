-- 354_proc_negotiations_source_columns.sql
-- Adds source_system and source_ref columns to proc_negotiations so that
-- negotiations created from RFQs or Tenders can be tracked back to their origin.
-- Also adds counter_price to proc_negotiation_rounds (the UI references it but
-- the column was missing from the original schema).

ALTER TABLE public.proc_negotiations
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_proc_negotiations_source_system
  ON public.proc_negotiations(source_system);

UPDATE public.proc_negotiations
SET source_system = 'procurement'
WHERE source_system IS NULL;

ALTER TABLE public.proc_negotiation_rounds
  ADD COLUMN IF NOT EXISTS counter_price NUMERIC;

COMMENT ON COLUMN public.proc_negotiations.source_system IS
  'Originating system: procurement (manual), rfq, tender, engineering, housekeeping, food_beverage';
COMMENT ON COLUMN public.proc_negotiations.source_ref IS
  'ID of the originating record (e.g. proc_rfqs.id or proc_tenders.id)';
