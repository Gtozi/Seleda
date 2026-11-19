-- 356_proc_purchase_orders_source_columns.sql
-- Adds source_system and source_ref columns to proc_purchase_orders so that
-- POs created from RFQ awards, tender awards, or department requisitions can
-- be tracked back to their origin.

ALTER TABLE public.proc_purchase_orders
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_ref TEXT,
  ADD COLUMN IF NOT EXISTS tender_id TEXT;

CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_source_system
  ON public.proc_purchase_orders(source_system);

CREATE INDEX IF NOT EXISTS idx_proc_purchase_orders_tender_id
  ON public.proc_purchase_orders(tender_id);

UPDATE public.proc_purchase_orders
SET source_system = 'procurement'
WHERE source_system IS NULL;

COMMENT ON COLUMN public.proc_purchase_orders.source_system IS
  'Originating system: procurement (manual), rfq, tender, engineering, housekeeping, food_beverage';
COMMENT ON COLUMN public.proc_purchase_orders.source_ref IS
  'ID of the originating record (e.g. proc_rfqs.id or proc_tenders.id)';
