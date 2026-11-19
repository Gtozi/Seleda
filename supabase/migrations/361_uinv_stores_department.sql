-- ════════════════════════════════════════════════════════════════
-- 361 — uinv_stores: add department column
--
-- Allows the inventory portal to create department-scoped stores that
-- are read-only from the inventory portal but visible to their
-- respective departments. Existing seeded department stores are
-- backfilled with their department names.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.uinv_stores
  ADD COLUMN IF NOT EXISTS department text;

-- Backfill seeded department stores by store_code
UPDATE public.uinv_stores SET department = 'Food & Beverage' WHERE store_code = 'UINV-ST-FOOD' AND department IS NULL;
UPDATE public.uinv_stores SET department = 'Food & Beverage' WHERE store_code = 'UINV-ST-BEV' AND department IS NULL;
UPDATE public.uinv_stores SET department = 'Housekeeping'     WHERE store_code = 'UINV-ST-HK'    AND department IS NULL;
UPDATE public.uinv_stores SET department = 'Housekeeping'     WHERE store_code = 'UINV-ST-LINEN' AND department IS NULL;
UPDATE public.uinv_stores SET department = 'Engineering'      WHERE store_code = 'UINV-ST-ENG'   AND department IS NULL;

CREATE INDEX IF NOT EXISTS idx_uinv_stores_department ON public.uinv_stores(department);
