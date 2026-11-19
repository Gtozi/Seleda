-- ============================================================
-- Migration 370: Unified Inventory Consolidation
-- ============================================================
-- Makes uinv_* the SOLE inventory system across the entire ERP.
--
-- This migration:
--   1. Adds per-store replenish_min / replenish_max columns to
--      uinv_stock_balances for auto-replenishment from Central.
--   2. Creates uinv_replenishment_rules table for configurable
--      auto-replenishment rules per department store.
--   3. Migrates legacy inventory_items rows into uinv_items +
--      uinv_stock_balances (mapping category_id → category text,
--      outlet_id → store_id).
--   4. Migrates spare_parts rows into uinv_items (Engineering
--      category) + uinv_stock_balances in UINV-ST-ENG.
--   5. Migrates hk_linen_stock rows into uinv_stock_balances in
--      UINV-ST-LINEN (creating uinv_items if they don't exist).
--   6. Migrates hk_amenity_stock rows into uinv_stock_balances in
--      UINV-ST-HK (creating uinv_items if they don't exist).
--   7. Creates a mapping table uinv_legacy_item_map to trace
--      legacy IDs → uinv IDs during the transition.
--   8. Creates the auto_replenish_department_stores() DB function.
--
-- After this migration, ALL department portals should read/write
-- through uinv_* tables exclusively. Legacy tables are NOT dropped
-- (they remain as historical read-only archives) but no new writes
-- should go to them.
-- ============================================================

DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Ensure the demo property exists in uinv_stores property_id columns
  -- (it already does from migration 346 seeds).
  NULL;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. Add replenish_min / replenish_max to uinv_stock_balances
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.uinv_stock_balances
  ADD COLUMN IF NOT EXISTS replenish_min numeric(12,3);
ALTER TABLE public.uinv_stock_balances
  ADD COLUMN IF NOT EXISTS replenish_max numeric(12,3);

-- Backfill: for department store balances, set replenish_min = item.min_stock
-- and replenish_max = item.max_stock (or par_level if max is null).
UPDATE public.uinv_stock_balances sb
  SET replenish_min = i.min_stock,
      replenish_max = COALESCE(i.max_stock, i.par_level)
  FROM public.uinv_items i
  WHERE sb.item_id = i.id
    AND sb.replenish_min IS NULL
    AND sb.store_id IN (
      SELECT id FROM public.uinv_stores
      WHERE store_type = 'Department' OR department IS NOT NULL
    );

-- For Main Warehouse balances, replenish_min/max = NULL (central is the source,
-- it doesn't auto-replenish from itself — it triggers procurement instead).
UPDATE public.uinv_stock_balances
  SET replenish_min = NULL, replenish_max = NULL
  WHERE store_id = 'UINV-ST-MAIN';

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_replenishment_rules — configurable auto-replenishment
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_replenishment_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  store_id text NOT NULL REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  item_id text REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  -- NULL item_id = rule applies to all items in the store
  replenish_min numeric(12,3) NOT NULL DEFAULT 0,
  replenish_max numeric(12,3) NOT NULL DEFAULT 0,
  -- Source store to replenish from (default: Main Warehouse)
  source_store_id text NOT NULL DEFAULT 'UINV-ST-MAIN',
  is_active boolean NOT NULL DEFAULT true,
  -- Auto = generated automatically by the scan function
  -- Manual = created by a user for a specific item
  rule_type text NOT NULL DEFAULT 'Auto',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_uinv_repl_rules_store
  ON public.uinv_replenishment_rules(store_id);
CREATE INDEX IF NOT EXISTS idx_uinv_repl_rules_active
  ON public.uinv_replenishment_rules(is_active);

ALTER TABLE public.uinv_replenishment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_replenishment_rules"
  ON public.uinv_replenishment_rules FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_replenishment_rules"
  ON public.uinv_replenishment_rules FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_replenishment_rules TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_legacy_item_map — trace legacy IDs → uinv IDs
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_legacy_item_map (
  legacy_table text NOT NULL,
  legacy_id text NOT NULL,
  uinv_item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  uinv_store_id text,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (legacy_table, legacy_id)
);

ALTER TABLE public.uinv_legacy_item_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read uinv_legacy_item_map"
  ON public.uinv_legacy_item_map FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.uinv_legacy_item_map TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. Migrate legacy inventory_items → uinv_items + uinv_stock_balances
-- ════════════════════════════════════════════════════════════════
-- The legacy inventory_items table (migration 256) has:
--   id, category_id, outlet_id, item_code, sku, name, description,
--   unit_of_measure, current_quantity, minimum_stock, maximum_stock,
--   reorder_point, unit_cost, average_cost, location, supplier,
--   last_purchase_date, expiry_date, batch_number, is_active
--
-- We map:
--   category_id → look up inventory_categories.name, then map to
--     the closest uinv category (Food & Beverage, Housekeeping, etc.)
--   outlet_id → determines which uinv store the balance goes to
--   current_quantity → on_hand in the appropriate store
--   name → item_name, item_code → item_code, sku → sku

DO $$
DECLARE
  prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
  r RECORD;
  v_uinv_item_id text;
  v_store_id text;
  v_category text;
  v_balance_id text;
  v_seq int := 500;
BEGIN
  -- Only proceed if the legacy table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'inventory_items'
  ) THEN
    RAISE NOTICE 'Legacy inventory_items table not found — skipping migration.';
    RETURN;
  END IF;

  FOR r IN
    SELECT
      li.id, li.category_id, li.outlet_id, li.item_code, li.sku,
      li.name, li.description, li.unit_of_measure, li.current_quantity,
      li.minimum_stock, li.maximum_stock, li.reorder_point,
      li.unit_cost, li.average_cost, li.location, li.supplier,
      li.is_active,
      ic.name AS cat_name
    FROM public.inventory_items li
    LEFT JOIN public.inventory_categories ic ON ic.id = li.category_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.uinv_legacy_item_map m
      WHERE m.legacy_table = 'inventory_items' AND m.legacy_id = li.id
    )
  LOOP
    -- Map legacy category to uinv category
    v_category := CASE
      WHEN r.cat_name ILIKE '%raw%' OR r.cat_name ILIKE '%semi%' OR r.cat_name ILIKE '%finished%' OR r.cat_name ILIKE '%beverage%' THEN 'Food & Beverage'
      WHEN r.cat_name ILIKE '%clean%' THEN 'Housekeeping'
      WHEN r.cat_name ILIKE '%disposable%' THEN 'Operating Supplies'
      WHEN r.cat_name ILIKE '%packaging%' THEN 'Operating Supplies'
      ELSE 'Operating Supplies'
    END;

    -- Determine target store based on outlet_id
    -- NULL or ST-MAIN → Main Warehouse; otherwise map by outlet
    v_store_id := CASE
      WHEN r.outlet_id IS NULL OR r.outlet_id = 'ST-MAIN' THEN 'UINV-ST-MAIN'
      WHEN r.outlet_id ILIKE '%food%' OR r.outlet_id ILIKE '%kitchen%' THEN 'UINV-ST-FOOD'
      WHEN r.outlet_id ILIKE '%bar%' OR r.outlet_id ILIKE '%bev%' THEN 'UINV-ST-BEV'
      WHEN r.outlet_id ILIKE '%hk%' OR r.outlet_id ILIKE '%house%' THEN 'UINV-ST-HK'
      WHEN r.outlet_id ILIKE '%eng%' OR r.outlet_id ILIKE '%maint%' THEN 'UINV-ST-ENG'
      ELSE 'UINV-ST-GEN'
    END;

    -- Generate uinv_item_id
    v_uinv_item_id := 'UINV-IT-MIG-' || v_seq;
    v_seq := v_seq + 1;

    -- Insert into uinv_items (skip if item_code already exists)
    INSERT INTO public.uinv_items (
      id, property_id, item_code, item_name, description,
      category, subcategory, item_type, brand,
      unit_of_measure, min_stock, max_stock, reorder_point,
      safety_stock, par_level, default_store_id,
      costing_method, last_cost, avg_cost, standard_cost, is_active
    ) VALUES (
      v_uinv_item_id, prop_id,
      COALESCE(r.item_code, 'MIG-' || v_seq),
      r.name,
      r.description,
      v_category,
      NULL,
      'Consumable',
      r.supplier,
      COALESCE(r.unit_of_measure, 'PCS'),
      COALESCE(r.minimum_stock, 0),
      r.maximum_stock,
      COALESCE(r.reorder_point, 0),
      0,
      COALESCE(r.maximum_stock, COALESCE(r.reorder_point, 0) * 2),
      v_store_id,
      'Weighted Average',
      COALESCE(r.unit_cost, 0),
      COALESCE(r.average_cost, r.unit_cost, 0),
      COALESCE(r.unit_cost, 0),
      COALESCE(r.is_active, true)
    )
    ON CONFLICT (id) DO NOTHING;

    -- Insert stock balance
    v_balance_id := 'UINV-SB-MIG-' || v_seq;
    INSERT INTO public.uinv_stock_balances (
      id, property_id, item_id, store_id, location_id,
      on_hand, reserved, allocated, on_order, in_transit,
      damaged, quarantined, expired, status, unit_cost,
      replenish_min, replenish_max
    ) VALUES (
      v_balance_id, prop_id, v_uinv_item_id, v_store_id, NULL,
      COALESCE(r.current_quantity, 0), 0, 0, 0, 0, 0, 0, 0,
      'Available'::public.uinv_stock_status,
      COALESCE(r.unit_cost, 0),
      CASE WHEN v_store_id != 'UINV-ST-MAIN' THEN COALESCE(r.minimum_stock, 0) ELSE NULL END,
      CASE WHEN v_store_id != 'UINV-ST-MAIN' THEN COALESCE(r.maximum_stock, COALESCE(r.reorder_point, 0) * 2) ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;

    -- Record the mapping
    INSERT INTO public.uinv_legacy_item_map (legacy_table, legacy_id, uinv_item_id, uinv_store_id)
    VALUES ('inventory_items', r.id, v_uinv_item_id, v_store_id)
    ON CONFLICT DO NOTHING;

  END LOOP;

  RAISE NOTICE 'Legacy inventory_items migration complete.';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 5. Migrate spare_parts → uinv_items (Engineering) + balances
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
  r RECORD;
  v_uinv_item_id text;
  v_balance_id text;
  v_seq int := 700;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'spare_parts'
  ) THEN
    RAISE NOTICE 'spare_parts table not found — skipping.';
    RETURN;
  END IF;

  FOR r IN
    SELECT
      sp.id, sp.part_number, sp.part_name, sp.category, sp.manufacturer,
      sp.compatible_assets, sp.unit, sp.min_stock, sp.max_stock,
      sp.current_stock, sp.unit_cost, sp.location, sp.reorder_qty,
      sp.supplier, sp.property_id
    FROM public.spare_parts sp
    WHERE NOT EXISTS (
      SELECT 1 FROM public.uinv_legacy_item_map m
      WHERE m.legacy_table = 'spare_parts' AND m.legacy_id = sp.id
    )
  LOOP
    v_uinv_item_id := 'UINV-IT-SP-' || v_seq;
    v_seq := v_seq + 1;

    INSERT INTO public.uinv_items (
      id, property_id, item_code, item_name, description,
      category, subcategory, item_type, brand, manufacturer,
      unit_of_measure, min_stock, max_stock, reorder_point,
      safety_stock, par_level, default_store_id,
      costing_method, last_cost, avg_cost, standard_cost, is_active
    ) VALUES (
      v_uinv_item_id,
      COALESCE(r.property_id, prop_id),
      COALESCE(r.part_number, 'SP-' || v_seq),
      r.part_name,
      NULL,
      'Engineering',
      r.category,
      'Spare Part',
      NULL,
      r.manufacturer,
      COALESCE(r.unit, 'pcs'),
      COALESCE(r.min_stock, 5),
      COALESCE(r.max_stock, 50),
      COALESCE(r.min_stock, 5),
      2,
      COALESCE(r.max_stock, 50),
      'UINV-ST-ENG',
      'Weighted Average',
      COALESCE(r.unit_cost, 0),
      COALESCE(r.unit_cost, 0),
      COALESCE(r.unit_cost, 0),
      true
    )
    ON CONFLICT (id) DO NOTHING;

    v_balance_id := 'UINV-SB-SP-' || v_seq;
    INSERT INTO public.uinv_stock_balances (
      id, property_id, item_id, store_id, location_id,
      on_hand, reserved, allocated, on_order, in_transit,
      damaged, quarantined, expired, status, unit_cost,
      replenish_min, replenish_max
    ) VALUES (
      v_balance_id,
      COALESCE(r.property_id, prop_id),
      v_uinv_item_id,
      'UINV-ST-ENG',
      NULL,
      COALESCE(r.current_stock, 0), 0, 0, 0, 0, 0, 0, 0,
      'Available'::public.uinv_stock_status,
      COALESCE(r.unit_cost, 0),
      COALESCE(r.min_stock, 5),
      COALESCE(r.max_stock, 50)
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.uinv_legacy_item_map (legacy_table, legacy_id, uinv_item_id, uinv_store_id)
    VALUES ('spare_parts', r.id, v_uinv_item_id, 'UINV-ST-ENG')
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'spare_parts migration complete.';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 6. Migrate hk_linen_stock → uinv_items + uinv_stock_balances (LINEN store)
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
  r RECORD;
  v_uinv_item_id text;
  v_balance_id text;
  v_seq int := 800;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hk_linen_stock'
  ) THEN
    RAISE NOTICE 'hk_linen_stock table not found — skipping.';
    RETURN;
  END IF;

  FOR r IN
    SELECT id, property_id, type, par, in_stock, in_use, at_laundry, damaged, lost
    FROM public.hk_linen_stock
    WHERE NOT EXISTS (
      SELECT 1 FROM public.uinv_legacy_item_map m
      WHERE m.legacy_table = 'hk_linen_stock' AND m.legacy_id = r.id::text
    )
  LOOP
    v_uinv_item_id := 'UINV-IT-LIN-' || v_seq;
    v_seq := v_seq + 1;

    -- Linen items are non-consumable (checked out, must be returned)
    INSERT INTO public.uinv_items (
      id, property_id, item_code, item_name, description,
      category, subcategory, item_type,
      unit_of_measure, min_stock, max_stock, reorder_point,
      safety_stock, par_level, default_store_id,
      costing_method, last_cost, avg_cost, standard_cost, is_active
    ) VALUES (
      v_uinv_item_id,
      COALESCE(r.property_id, prop_id),
      'LIN-' || v_seq,
      r.type,
      'Linen item (migrated from hk_linen_stock)',
      'Housekeeping',
      'Laundry Supplies',
      'Linen',
      'pcs',
      LEAST(COALESCE(r.par, 0), 10),
      COALESCE(r.par, 0) * 2,
      LEAST(COALESCE(r.par, 0), 10),
      5,
      COALESCE(r.par, 0),
      'UINV-ST-LINEN',
      'Weighted Average',
      0, 0, 0,
      true
    )
    ON CONFLICT (id) DO NOTHING;

    -- Total on_hand = in_stock (available in linen store)
    -- in_use / at_laundry / damaged / lost are tracked as sub-statuses
    v_balance_id := 'UINV-SB-LIN-' || v_seq;
    INSERT INTO public.uinv_stock_balances (
      id, property_id, item_id, store_id, location_id,
      on_hand, reserved, allocated, on_order, in_transit,
      damaged, quarantined, expired, status, unit_cost,
      replenish_min, replenish_max
    ) VALUES (
      v_balance_id,
      COALESCE(r.property_id, prop_id),
      v_uinv_item_id,
      'UINV-ST-LINEN',
      NULL,
      COALESCE(r.in_stock, 0),
      COALESCE(r.in_use, 0),    -- reserved = in use
      0,
      0,
      COALESCE(r.at_laundry, 0), -- in_transit = at laundry
      COALESCE(r.damaged, 0),
      0,
      COALESCE(r.lost, 0),       -- expired column repurposed for lost count
      'Available'::public.uinv_stock_status,
      0,
      LEAST(COALESCE(r.par, 0), 10),
      COALESCE(r.par, 0) * 2
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.uinv_legacy_item_map (legacy_table, legacy_id, uinv_item_id, uinv_store_id)
    VALUES ('hk_linen_stock', r.id::text, v_uinv_item_id, 'UINV-ST-LINEN')
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'hk_linen_stock migration complete.';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 7. Migrate hk_amenity_stock → uinv_items + uinv_stock_balances (HK store)
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
  r RECORD;
  v_uinv_item_id text;
  v_balance_id text;
  v_seq int := 900;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hk_amenity_stock'
  ) THEN
    RAISE NOTICE 'hk_amenity_stock table not found — skipping.';
    RETURN;
  END IF;

  FOR r IN
    SELECT id, property_id, type, par, in_stock, consumed_today
    FROM public.hk_amenity_stock
    WHERE NOT EXISTS (
      SELECT 1 FROM public.uinv_legacy_item_map m
      WHERE m.legacy_table = 'hk_amenity_stock' AND m.legacy_id = r.id::text
    )
  LOOP
    v_uinv_item_id := 'UINV-IT-AM-' || v_seq;
    v_seq := v_seq + 1;

    INSERT INTO public.uinv_items (
      id, property_id, item_code, item_name, description,
      category, subcategory, item_type,
      unit_of_measure, min_stock, max_stock, reorder_point,
      safety_stock, par_level, default_store_id,
      costing_method, last_cost, avg_cost, standard_cost, is_active
    ) VALUES (
      v_uinv_item_id,
      COALESCE(r.property_id, prop_id),
      'AM-' || v_seq,
      r.type,
      'Guest amenity (migrated from hk_amenity_stock)',
      'Housekeeping',
      'Guest Amenities',
      'Consumable',
      'pcs',
      LEAST(COALESCE(r.par, 0), 50),
      COALESCE(r.par, 0) * 2,
      LEAST(COALESCE(r.par, 0), 50),
      20,
      COALESCE(r.par, 0),
      'UINV-ST-HK',
      'Weighted Average',
      0, 0, 0,
      true
    )
    ON CONFLICT (id) DO NOTHING;

    v_balance_id := 'UINV-SB-AM-' || v_seq;
    INSERT INTO public.uinv_stock_balances (
      id, property_id, item_id, store_id, location_id,
      on_hand, reserved, allocated, on_order, in_transit,
      damaged, quarantined, expired, status, unit_cost,
      replenish_min, replenish_max
    ) VALUES (
      v_balance_id,
      COALESCE(r.property_id, prop_id),
      v_uinv_item_id,
      'UINV-ST-HK',
      NULL,
      COALESCE(r.in_stock, 0),
      0, 0, 0, 0, 0, 0, 0,
      'Available'::public.uinv_stock_status,
      0,
      LEAST(COALESCE(r.par, 0), 50),
      COALESCE(r.par, 0) * 2
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.uinv_legacy_item_map (legacy_table, legacy_id, uinv_item_id, uinv_store_id)
    VALUES ('hk_amenity_stock', r.id::text, v_uinv_item_id, 'UINV-ST-HK')
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'hk_amenity_stock migration complete.';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 8. Seed default replenishment rules for department stores
-- ════════════════════════════════════════════════════════════════
-- For every department store balance that has replenish_min set,
-- create a matching uinv_replenishment_rules row (item-specific).
INSERT INTO public.uinv_replenishment_rules (
  property_id, store_id, item_id, replenish_min, replenish_max,
  source_store_id, is_active, rule_type
)
SELECT
  sb.property_id, sb.store_id, sb.item_id,
  sb.replenish_min, sb.replenish_max,
  'UINV-ST-MAIN', true, 'Auto'
FROM public.uinv_stock_balances sb
WHERE sb.replenish_min IS NOT NULL
  AND sb.store_id != 'UINV-ST-MAIN'
  AND NOT EXISTS (
    SELECT 1 FROM public.uinv_replenishment_rules rr
    WHERE rr.store_id = sb.store_id AND rr.item_id = sb.item_id
  )
ON CONFLICT (store_id, item_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 9. auto_replenish_department_stores() DB function
-- ════════════════════════════════════════════════════════════════
-- Scans all department store balances where on_hand <= replenish_min.
-- For each, creates a uinv_transfers row from Main Warehouse to the
-- department store, deducts from Main, adds to department store, and
-- logs to the stock ledger. Returns a summary of generated transfers.
--
-- This function is called by:
--   - POST /api/uinv-portal/replenishment/auto-replenish (manual trigger)
--   - Can be scheduled via pg_cron (see end of migration)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_replenish_department_stores(
  p_property_id uuid DEFAULT NULL
)
RETURNS TABLE (
  transfer_number text,
  store_id text,
  item_name text,
  quantity numeric,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer_number text;
  v_seq int;
  v_count int;
  v_main_on_hand numeric;
  v_transfer_qty numeric;
  v_balance_id text;
  v_main_balance_id text;
  r RECORD;
BEGIN
  v_seq := 0;

  FOR r IN
    SELECT
      sb.id AS balance_id,
      sb.property_id,
      sb.store_id,
      sb.item_id,
      sb.on_hand,
      sb.replenish_min,
      sb.replenish_max,
      sb.unit_cost,
      i.item_name,
      i.unit_of_measure
    FROM public.uinv_stock_balances sb
    JOIN public.uinv_items i ON i.id = sb.item_id
    WHERE sb.replenish_min IS NOT NULL
      AND sb.on_hand <= sb.replenish_min
      AND sb.store_id != 'UINV-ST-MAIN'
      AND (p_property_id IS NULL OR sb.property_id = p_property_id)
    ORDER BY sb.store_id, i.item_name
  LOOP
    -- Calculate transfer quantity: fill to replenish_max
    v_transfer_qty := COALESCE(r.replenish_max, r.replenish_min * 2) - r.on_hand;
    IF v_transfer_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Check Main Warehouse has enough stock
    SELECT id, on_hand INTO v_main_balance_id, v_main_on_hand
    FROM public.uinv_stock_balances
    WHERE item_id = r.item_id AND store_id = 'UINV-ST-MAIN'
    LIMIT 1;

    -- If Main doesn't have enough, transfer what's available (or skip if zero)
    IF v_main_on_hand IS NULL OR v_main_on_hand <= 0 THEN
      -- Main has no stock — create a replenishment suggestion instead
      CONTINUE;
    END IF;
    v_transfer_qty := LEAST(v_transfer_qty, v_main_on_hand);

    -- Generate transfer number
    v_seq := v_seq + 1;
    SELECT COUNT(*) + 1 INTO v_count FROM public.uinv_transfers;
    v_transfer_number := 'TR-REPL-' || LPAD(v_count::text, 6, '0');

    -- Create the transfer record
    INSERT INTO public.uinv_transfers (
      id, property_id, transfer_number,
      from_store_id, to_store_id,
      lines, transfer_value, status, priority,
      created_at, updated_at
    ) VALUES (
      'UINV-TX-REPL-' || v_seq || '-' || EXTRACT(EPOCH FROM now())::bigint,
      r.property_id,
      v_transfer_number,
      'UINV-ST-MAIN',
      r.store_id,
      jsonb_build_array(jsonb_build_object(
        'itemId', r.item_id,
        'itemName', r.item_name,
        'quantity', v_transfer_qty,
        'unit', r.unit_of_measure,
        'unitCost', r.unit_cost
      )),
      v_transfer_qty * r.unit_cost,
      'Completed',
      'Normal',
      now(), now()
    );

    -- Deduct from Main Warehouse
    UPDATE public.uinv_stock_balances
      SET on_hand = on_hand - v_transfer_qty,
          last_movement_date = now(),
          updated_at = now()
      WHERE id = v_main_balance_id;

    -- Add to department store
    UPDATE public.uinv_stock_balances
      SET on_hand = on_hand + v_transfer_qty,
          last_movement_date = now(),
          updated_at = now()
      WHERE id = r.balance_id;

    -- Log to stock ledger (Main out)
    INSERT INTO public.uinv_stock_ledger (
      id, property_id, item_id, store_id,
      transaction_type, reference, quantity_in, quantity_out,
      balance, unit_cost, value, performed_by, reason, transaction_date
    ) VALUES (
      'UINV-LG-REPL-OUT-' || v_seq,
      r.property_id, r.item_id, 'UINV-ST-MAIN',
      'Transfer Out', v_transfer_number, 0, v_transfer_qty,
      v_main_on_hand - v_transfer_qty, r.unit_cost,
      v_transfer_qty * r.unit_cost, 'system',
      'Auto-replenish to ' || r.store_id, now()
    );

    -- Log to stock ledger (department in)
    INSERT INTO public.uinv_stock_ledger (
      id, property_id, item_id, store_id,
      transaction_type, reference, quantity_in, quantity_out,
      balance, unit_cost, value, performed_by, reason, transaction_date
    ) VALUES (
      'UINV-LG-REPL-IN-' || v_seq,
      r.property_id, r.item_id, r.store_id,
      'Transfer In', v_transfer_number, v_transfer_qty, 0,
      r.on_hand + v_transfer_qty, r.unit_cost,
      v_transfer_qty * r.unit_cost, 'system',
      'Auto-replenish from Main Warehouse', now()
    );

    transfer_number := v_transfer_number;
    store_id := r.store_id;
    item_name := r.item_name;
    quantity := v_transfer_qty;
    status := 'Completed';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_replenish_department_stores(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 10. Add 'Linen' to valid item_type values (used by linen migration)
--     The uinv_items.item_type is a TEXT column (not an enum), so
--     no ALTER TYPE needed — just documentation that 'Linen' is valid.
-- ════════════════════════════════════════════════════════════════
-- No-op: item_type is TEXT, accepts any value.

-- ════════════════════════════════════════════════════════════════
-- 11. Add 'is_department_store' flag to uinv_stores for clarity
-- ════════════════════════════════════════════════════════════════
-- Already handled by the `department` column (migration 361).
-- A store is a department store if department IS NOT NULL.

-- ════════════════════════════════════════════════════════════════
-- 12. Optional: schedule auto-replenish via pg_cron (if available)
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Run auto-replenish every 2 hours
    PERFORM cron.schedule(
      'uinv-auto-replenish',
      '0 */2 * * *',
      $$SELECT * FROM public.auto_replenish_department_stores();$$
    );
    RAISE NOTICE 'pg_cron: scheduled auto-replenish every 2 hours.';
  ELSE
    RAISE NOTICE 'pg_cron not installed — auto-replenish must be triggered via API.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 13. Add 'Auto-Replenish' as a valid transfer status context
--     and add replenishment_source column to uinv_transfers
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.uinv_transfers
  ADD COLUMN IF NOT EXISTS replenishment_source text;

-- Mark auto-generated replenishment transfers
UPDATE public.uinv_transfers
  SET replenishment_source = 'auto'
  WHERE transfer_number LIKE 'TR-REPL-%';

-- ════════════════════════════════════════════════════════════════
-- Verification queries (run manually after migration)
-- ════════════════════════════════════════════════════════════════
-- SELECT 'items' AS what, COUNT(*) AS cnt FROM public.uinv_items
-- UNION ALL SELECT 'balances', COUNT(*) FROM public.uinv_stock_balances
-- UNION ALL SELECT 'dept_balances', COUNT(*) FROM public.uinv_stock_balances WHERE store_id != 'UINV-ST-MAIN'
-- UNION ALL SELECT 'replenish_rules', COUNT(*) FROM public.uinv_replenishment_rules
-- UNION ALL SELECT 'migrated_from_legacy', COUNT(*) FROM public.uinv_legacy_item_map;
