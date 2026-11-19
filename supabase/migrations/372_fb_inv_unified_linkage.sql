-- ════════════════════════════════════════════════════════════════
-- 372 — F&B / Unified Inventory explicit linkage + data-driven store routing
--
-- Closes two gaps in the F&B ↔ unified inventory dual-write bridge:
--
-- 1. inventory_items.uinv_item_id
--    Explicit FK from each legacy F&B inventory_items row to its
--    unified uinv_items counterpart. Replaces the fragile case-
--    insensitive name match in resolveUinvItemByName() with a direct
--    ID lookup (name match remains a fallback for un-linked rows).
--    Mirrors the hk_minibar_catalog.inventory_item_id pattern (371).
--
-- 2. outlets.default_store_id
--    Explicit FK from each F&B outlet to its default unified uinv_stores
--    row. Replaces the substring heuristic in resolveFbStoreForOutlet()
--    ("bar"/"bev"/"lounge" → BEV store) with a data-driven lookup.
--    Backfilled from outlet.type: Bar/Minibar → UINV-ST-BEV, else FOOD.
--
-- All additions are nullable and additive — no data loss, no breaking
-- changes. Existing rows simply have NULL until backfilled/linked.
-- ════════════════════════════════════════════════════════════════

-- ── 1. inventory_items.uinv_item_id ──────────────────────────────
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS uinv_item_id text REFERENCES public.uinv_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_uinv_item_id
  ON public.inventory_items(uinv_item_id);

-- ── 2. outlets.default_store_id ──────────────────────────────────
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS default_store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outlets_default_store_id
  ON public.outlets(default_store_id);

-- ── 3. Backfill outlets.default_store_id from outlet.type ─────────
-- Bar / Minibar outlets → beverage store; everything else → food store.
-- Only touches rows where default_store_id is still NULL.
UPDATE public.outlets
  SET default_store_id = 'UINV-ST-BEV'
  WHERE default_store_id IS NULL
    AND type IN ('Bar', 'Minibar');

UPDATE public.outlets
  SET default_store_id = 'UINV-ST-FOOD'
  WHERE default_store_id IS NULL
    AND type NOT IN ('Bar', 'Minibar');

-- ── 4. Best-effort backfill of inventory_items.uinv_item_id ───────
-- Link legacy rows to unified items by exact (case-insensitive) name
-- match within the Food & Beverage category. Rows with no match stay
-- NULL and will fall back to the runtime name-match resolver.
UPDATE public.inventory_items ii
  SET uinv_item_id = ui.id
  FROM public.uinv_items ui
  WHERE ii.uinv_item_id IS NULL
    AND lower(ii.name) = lower(ui.item_name)
    AND ui.category = 'Food & Beverage';
