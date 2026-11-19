-- 369_uinv_distribute_stock_to_dept_stores.sql
-- Distribute stock balances from Main Warehouse to department stores
-- based on item category → store department mapping.
--
-- Problem: all 24 stock balances exist only in UINV-ST-MAIN (Main Warehouse).
-- Department stores (FOOD, BEV, HK, ENG, LINEN, GEN) have zero stock,
-- so stock counts and auto-populate per store return nothing.
--
-- Solution: for each item in Main Warehouse, create a matching balance row
-- in the appropriate department store(s). Split the on_hand quantity:
--   - 60% stays in Main Warehouse (central reserve)
--   - 40% moves to the department store (working stock)
--
-- Category → Store mapping:
--   Food & Beverage     → UINV-ST-FOOD (Food Store)
--   Housekeeping        → UINV-ST-HK (Housekeeping Store)
--   Engineering         → UINV-ST-ENG (Engineering Store)
--   All other categories → UINV-ST-GEN (General Store)
--
-- Linen items (subcategory 'Laundry Supplies') also get a balance in UINV-ST-LINEN.
-- ============================================================

DO $$
DECLARE
  prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
  r RECORD;
  dept_store_id text;
  linen_store_id text := 'UINV-ST-LINEN';
  main_qty numeric;
  dept_qty numeric;
  new_id text;
  seq int := 100;
BEGIN
  -- Loop over all Main Warehouse stock balances
  FOR r IN
    SELECT sb.id, sb.item_id, sb.on_hand, sb.unit_cost, sb.status,
           i.category, i.subcategory, i.item_name
    FROM public.uinv_stock_balances sb
    JOIN public.uinv_items i ON i.id = sb.item_id
    WHERE sb.store_id = 'UINV-ST-MAIN'
  LOOP
    -- Determine which department store this item belongs to
    dept_store_id := CASE
      WHEN r.category = 'Food & Beverage' THEN 'UINV-ST-FOOD'
      WHEN r.category = 'Housekeeping' THEN 'UINV-ST-HK'
      WHEN r.category = 'Engineering' THEN 'UINV-ST-ENG'
      ELSE 'UINV-ST-GEN'
    END;

    -- Split: 60% Main, 40% Department
    main_qty := ROUND(r.on_hand * 0.60);
    dept_qty := r.on_hand - main_qty;

    -- Update Main Warehouse balance to 60%
    UPDATE public.uinv_stock_balances
      SET on_hand = main_qty, last_movement_date = now()
      WHERE id = r.id;

    -- Insert department store balance (40%) if it doesn't exist
    IF dept_qty > 0 THEN
      new_id := 'UINV-SB-DEPT-' || seq;
      seq := seq + 1;

      INSERT INTO public.uinv_stock_balances (
        id, property_id, item_id, store_id, location_id,
        on_hand, reserved, allocated, on_order, in_transit,
        damaged, quarantined, expired, status, unit_cost,
        last_movement_date, created_at, updated_at
      ) VALUES (
        new_id, prop_id, r.item_id, dept_store_id, NULL,
        dept_qty, 0, 0, 0, 0, 0, 0, 0, 'Available', r.unit_cost,
        now(), now(), now()
      )
      ON CONFLICT (id) DO NOTHING;

      -- If this is a linen item (subcategory = 'Laundry Supplies'), also create a LINEN store balance
      IF r.subcategory = 'Laundry Supplies' AND dept_store_id = 'UINV-ST-HK' THEN
        new_id := 'UINV-SB-LINEN-' || seq;
        seq := seq + 1;
        INSERT INTO public.uinv_stock_balances (
          id, property_id, item_id, store_id, location_id,
          on_hand, reserved, allocated, on_order, in_transit,
          damaged, quarantined, expired, status, unit_cost,
          last_movement_date, created_at, updated_at
        ) VALUES (
          new_id, prop_id, r.item_id, linen_store_id, NULL,
          ROUND(dept_qty * 0.5), 0, 0, 0, 0, 0, 0, 0, 'Available', r.unit_cost,
          now(), now(), now()
        )
        ON CONFLICT (id) DO NOTHING;
        -- Reduce HK store by the linen amount
        UPDATE public.uinv_stock_balances
          SET on_hand = dept_qty - ROUND(dept_qty * 0.5)
          WHERE id = 'UINV-SB-DEPT-' || (seq - 2);
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Stock distribution complete.';
END $$;

-- Verify the distribution
-- SELECT s.store_code, s.store_name, COUNT(sb.id) as item_count, SUM(sb.on_hand) as total_qty
-- FROM public.uinv_stores s
-- LEFT JOIN public.uinv_stock_balances sb ON sb.store_id = s.id
-- GROUP BY s.store_code, s.store_name
-- ORDER BY s.store_type, s.store_code;
