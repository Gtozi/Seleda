-- ════════════════════════════════════════════════════════════════
-- 378 — issue_stock_to_department RPC: department-column fallback
--
-- Problem: the issue_stock_to_department() RPC (migration 375) resolves
-- the department store exclusively via:
--     WHERE s.parent_store_id = 'UINV-ST-MAIN' AND s.department = ...
-- If a department store was created without parent_store_id (the case
-- for all seeded stores before migration 377), v_dept_store_id is NULL
-- and the distribution silently writes stock to a NULL store_id or
-- fails on the FK constraint.
--
-- Solution: replace the function with a version that falls back to the
-- `department` column alone when the parent_store_id lookup returns
-- nothing. This makes the RPC robust whether or not migration 377 has
-- been applied, and handles stores created via the portal that may not
-- have parent_store_id set yet.
--
-- The rest of the function body is unchanged from migration 375.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.issue_stock_to_department(
  p_issue_id text,
  p_performed_by text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issue RECORD;
  v_dept_store_id text;
  v_line RECORD;
  v_main_bal RECORD;
  v_dept_bal RECORD;
  v_new_main_on_hand numeric;
  v_new_dept_on_hand numeric;
  v_result jsonb := jsonb_build_object('success', true, 'issued_lines', '[]'::jsonb, 'errors', '[]'::jsonb);
  v_issued_lines jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_item_type text;
  v_consumable_types text[] := ARRAY['Consumable', 'Food', 'Beverage', 'Inventory Item'];
  v_now timestamptz := now();
BEGIN
  -- Lock the issue row for the duration of the transaction
  SELECT * INTO v_issue FROM public.uinv_issues WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array('Issue not found'));
  END IF;

  -- Resolve the department store.
  -- Primary: child of Main Warehouse with matching department.
  -- Fallback: any active store with matching department (handles seeded
  -- stores that don't have parent_store_id set yet).
  SELECT s.id INTO v_dept_store_id
    FROM public.uinv_stores s
    WHERE s.parent_store_id = 'UINV-ST-MAIN'
      AND s.department = v_issue.department
      AND s.is_active = true
    LIMIT 1;

  IF v_dept_store_id IS NULL THEN
    SELECT s.id INTO v_dept_store_id
      FROM public.uinv_stores s
      WHERE s.department = v_issue.department
        AND s.is_active = true
        AND s.store_code <> 'MAIN'
      ORDER BY (s.parent_store_id = 'UINV-ST-MAIN') DESC, s.store_name
      LIMIT 1;
  END IF;

  IF v_dept_store_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errors', jsonb_build_array(jsonb_build_object(
        'error', 'No active department store found for: ' || COALESCE(v_issue.department, '(null)')
      ))
    );
  END IF;

  -- Process each line
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_issue.lines) WITH ORDINALITY AS t(line, idx)
  LOOP
    -- Skip lines without an item or with zero issue quantity
    IF (v_line.line->>'itemId') IS NULL OR COALESCE((v_line.line->>'issuedQty')::numeric, 0) <= 0 THEN
      CONTINUE;
    END IF;

    -- Check if the item is a consumable or an asset
    SELECT item_type INTO v_item_type FROM public.uinv_items WHERE id = v_line.line->>'itemId';
    IF v_item_type IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.line->>'itemId',
        'error', 'Item not found'
      ));
      CONTINUE;
    END IF;

    -- Non-consumable assets are skipped here (handled in app layer as checkouts)
    IF NOT (v_item_type = ANY(v_consumable_types)) THEN
      CONTINUE;
    END IF;

    -- 1. Deduct from MAIN warehouse
    SELECT id, on_hand, unit_cost, location_id INTO v_main_bal
      FROM public.uinv_stock_balances
      WHERE item_id = v_line.line->>'itemId'
        AND store_id = 'UINV-ST-MAIN'
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

    IF NOT FOUND OR v_main_bal.on_hand < (v_line.line->>'issuedQty')::numeric THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.line->>'itemId',
        'itemName', v_line.line->>'itemName',
        'error', 'Insufficient stock in Main Warehouse',
        'available', COALESCE(v_main_bal.on_hand, 0)
      ));
      CONTINUE;
    END IF;

    v_new_main_on_hand := v_main_bal.on_hand - (v_line.line->>'issuedQty')::numeric;

    UPDATE public.uinv_stock_balances
      SET on_hand = v_new_main_on_hand,
          last_movement_date = v_now,
          updated_at = v_now
      WHERE id = v_main_bal.id;

    -- Ledger: Department Issue (out of MAIN)
    INSERT INTO public.uinv_stock_ledger (
      property_id, item_id, store_id, location_id,
      transaction_type, reference,
      quantity_in, quantity_out, balance,
      unit_cost, value, performed_by, reason, transaction_date
    ) VALUES (
      v_issue.property_id,
      v_line.line->>'itemId',
      'UINV-ST-MAIN',
      v_main_bal.location_id,
      'Department Issue',
      v_issue.issue_number,
      0,
      (v_line.line->>'issuedQty')::numeric,
      v_new_main_on_hand,
      COALESCE((v_line.line->>'cost')::numeric, 0),
      (v_line.line->>'issuedQty')::numeric * COALESCE((v_line.line->>'cost')::numeric, 0),
      p_performed_by,
      'Issue to ' || v_issue.department,
      v_now
    );

    -- 2. Add to department store (upsert)
    SELECT id, on_hand INTO v_dept_bal
      FROM public.uinv_stock_balances
      WHERE item_id = v_line.line->>'itemId'
        AND store_id = v_dept_store_id
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

    IF FOUND THEN
      v_new_dept_on_hand := v_dept_bal.on_hand + (v_line.line->>'issuedQty')::numeric;
      UPDATE public.uinv_stock_balances
        SET on_hand = v_new_dept_on_hand,
            last_movement_date = v_now,
            updated_at = v_now
        WHERE id = v_dept_bal.id;
    ELSE
      v_new_dept_on_hand := (v_line.line->>'issuedQty')::numeric;
      INSERT INTO public.uinv_stock_balances (
        id, property_id, item_id, store_id, location_id,
        on_hand, reserved, allocated, on_order, in_transit,
        damaged, quarantined, expired, status, unit_cost,
        last_movement_date
      ) VALUES (
        'UINV-SB-DEPT-' || extract(epoch from v_now)::bigint::text || '-' || md5(v_line.line->>'itemId' || v_dept_store_id)::substr(1, 6),
        v_issue.property_id,
        v_line.line->>'itemId',
        v_dept_store_id,
        NULL,
        v_new_dept_on_hand,
        0, 0, 0, 0, 0, 0, 0, 'Available',
        COALESCE((v_line.line->>'cost')::numeric, 0),
        v_now
      );
    END IF;

    -- Ledger: Department Receipt (into dept store)
    INSERT INTO public.uinv_stock_ledger (
      property_id, item_id, store_id, location_id,
      transaction_type, reference,
      quantity_in, quantity_out, balance,
      unit_cost, value, performed_by, reason, transaction_date
    ) VALUES (
      v_issue.property_id,
      v_line.line->>'itemId',
      v_dept_store_id,
      NULL,
      'Department Receipt',
      v_issue.issue_number,
      (v_line.line->>'issuedQty')::numeric,
      0,
      v_new_dept_on_hand,
      COALESCE((v_line.line->>'cost')::numeric, 0),
      (v_line.line->>'issuedQty')::numeric * COALESCE((v_line.line->>'cost')::numeric, 0),
      p_performed_by,
      'Received from Main Warehouse for ' || v_issue.department,
      v_now
    );

    v_issued_lines := v_issued_lines || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.line->>'itemId',
      'issuedQty', (v_line.line->>'issuedQty')::numeric,
      'newMainOnHand', v_new_main_on_hand,
      'newDeptOnHand', v_new_dept_on_hand
    ));
  END LOOP;

  -- If any errors occurred, roll back the entire transaction
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'Stock distribution failed for issue %: %', p_issue_id, v_errors::text
      USING ERRCODE = 'P0001';
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'issued_lines', v_issued_lines,
    'errors', v_errors,
    'dept_store_id', v_dept_store_id
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_stock_to_department(text, text) TO authenticated;

COMMENT ON FUNCTION public.issue_stock_to_department IS
  'Atomically distribute consumable stock from Main Warehouse to a department store for all lines of an issue. Rolls back on any failure. Non-consumable assets are skipped (handled in app layer). Resolves dept store via parent_store_id first, then falls back to the department column.';
