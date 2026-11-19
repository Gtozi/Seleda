-- ════════════════════════════════════════════════════════════════
-- 371 — hk_minibar_catalog: add inventory_item_id linkage column
--
-- Enables explicit linkage between Housekeeping Minibar Catalog items
-- and Unified Inventory items (uinv_items) in the Beverage/Food category.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.hk_minibar_catalog
  ADD COLUMN IF NOT EXISTS inventory_item_id text REFERENCES public.uinv_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hk_minibar_catalog_inventory_item_id
  ON public.hk_minibar_catalog(inventory_item_id);
