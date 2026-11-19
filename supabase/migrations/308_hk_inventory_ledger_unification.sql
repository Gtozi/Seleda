-- Migration 308: HK Inventory Ledger Unification
-- Moves Housekeeping inventory from the standalone ops_housekeeping_inventory +
-- hk_inventory_transfers tables onto the shared inventory_items +
-- inventory_transactions ledger used by F&B. This enables the full 8-tab
-- Inventory Coordination UI (Inventory, Requisitions, Consumption, Waste,
-- Transfers, Stock Movements, Stock Count, Variance) for HK.
--
-- Both legacy tables are empty in the live DB (verified before migration),
-- so no backfill is required. They are dropped in this migration.
--
-- Key design decisions:
--   * property_id (text, nullable) is added to both shared tables. F&B rows
--     have property_id = NULL; HK rows have it set. This keeps F&B and HK
--     data isolated without a separate table.
--   * outlet_id / from_outlet_id / to_outlet_id are already nullable on the
--     shared tables, so HK rows simply leave them NULL.
--   * waste_type, theoretical_qty, actual_qty already exist on
--     inventory_transactions — no new columns needed for waste/variance.
--   * reorder_quantity is added to inventory_items (HK uses it; F&B uses
--     maximum_stock instead — both coexist).
--   * HK category strings (cleaning_supplies, linens, equipment, amenities,
--     other) are mapped to inventory_categories by code.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Add property_id + reorder_quantity to inventory_items
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS property_id text;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS reorder_quantity numeric(10,3) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inventory_items_property
  ON public.inventory_items(property_id)
  WHERE property_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Add property_id to inventory_transactions
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS property_id text;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_property
  ON public.inventory_transactions(property_id)
  WHERE property_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Insert missing HK categories into inventory_categories
--    Cleaning Supplies (CLEAN) and Equipment (EQUIP) already exist.
--    Linens, Amenities, Other need to be created.
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.inventory_categories (id, name, code, description)
SELECT gen_random_uuid()::text, 'Linens', 'LINENS', 'Housekeeping linen items (sheets, towels, pillowcases)'
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_categories WHERE code = 'LINENS');

INSERT INTO public.inventory_categories (id, name, code, description)
SELECT gen_random_uuid()::text, 'Amenities', 'AMEN', 'Guest room amenities (soap, shampoo, lotion)'
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_categories WHERE code = 'AMEN');

INSERT INTO public.inventory_categories (id, name, code, description)
SELECT gen_random_uuid()::text, 'Other', 'OTHER', 'Miscellaneous housekeeping items'
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_categories WHERE code = 'OTHER');

-- ════════════════════════════════════════════════════════════════════════
-- 4. Drop legacy HK inventory tables (both verified empty)
-- ════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS public.hk_inventory_transfers CASCADE;
DROP TABLE IF EXISTS public.ops_housekeeping_inventory CASCADE;
