-- ════════════════════════════════════════════════════════════════
-- 377 — Department Store Hierarchy Fix
--
-- Problem: the seeded department stores (FOOD, BEV, HK, LINEN, ENG, GEN)
-- were created by migration 346 WITHOUT setting parent_store_id. They all
-- have parent_store_id = NULL. This breaks three flows that rely on the
-- parent_store_id = 'UINV-ST-MAIN' relationship:
--
--   1. findDeptStore() in unifiedInventoryPortal.routes.ts queries
--      `parent_store_id = MAIN_STORE_ID` → returns NULL for all seeded
--      stores, so issue distribution can't resolve the target dept store.
--   2. issue_stock_to_department() RPC (migration 375) queries
--      `parent_store_id = 'UINV-ST-MAIN'` → v_dept_store_id is NULL →
--      stock distribution fails or writes to a NULL store_id.
--   3. POST /stores/transfer-stock rejects stores where
--      `parent_store_id !== MAIN_STORE_ID` → the "Transfer" button in
--      StoresModule.tsx returns 400 for every seeded department store.
--
-- Additionally, the seeded stores have store_type = 'Warehouse' instead
-- of 'Department', which is inconsistent with the hierarchy model and
-- the findDeptStore() docstring.
--
-- Solution:
--   a. Set parent_store_id = 'UINV-ST-MAIN' on all stores that have a
--      department assigned (excluding the Main Warehouse itself and the
--      Inventory portal's own stores).
--   b. Set store_type = 'Department' on those same stores so the
--      hierarchy is self-consistent.
--   c. Add an index on parent_store_id for the lookup queries.
--
-- Idempotent: uses WHERE guards so re-running is safe.
-- ════════════════════════════════════════════════════════════════

-- a. Link department stores to the Main Warehouse as their parent.
--    Covers both the original seeded stores (by store_code) and any
--    stores created later via the inventory portal that have a
--    department column set.
UPDATE public.uinv_stores
  SET parent_store_id = 'UINV-ST-MAIN'
  WHERE department IS NOT NULL
    AND department <> 'Inventory'
    AND store_code <> 'MAIN'
    AND parent_store_id IS NULL;

-- b. Normalize store_type to 'Department' for stores that belong to a
--    department (excluding Main Warehouse and unscoped warehouses).
UPDATE public.uinv_stores
  SET store_type = 'Department'
  WHERE department IS NOT NULL
    AND department <> 'Inventory'
    AND store_code <> 'MAIN'
    AND store_type = 'Warehouse';

-- c. Index for parent_store_id lookups (used by findDeptStore + RPC).
CREATE INDEX IF NOT EXISTS idx_uinv_stores_parent_store
  ON public.uinv_stores(parent_store_id);

-- ════════════════════════════════════════════════════════════════
-- Verification
-- ════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_orphans int;
BEGIN
  SELECT COUNT(*) INTO v_orphans
    FROM public.uinv_stores
    WHERE department IS NOT NULL
      AND department <> 'Inventory'
      AND store_code <> 'MAIN'
      AND parent_store_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE NOTICE 'WARNING: % department store(s) still have NULL parent_store_id.', v_orphans;
  ELSE
    RAISE NOTICE 'Migration 377 complete: all department stores linked to Main Warehouse.';
  END IF;
END $verify$;
