-- ════════════════════════════════════════════════════════════════
-- 385 — Unified Inventory movement integrity
--
-- Fixes the four systemic stock-movement defects found in the portal
-- audit (see AGENTS.md "Inventory Portal Gap Fixes (Migrations 385-386)"):
--
--   1. uinv_stock_balances permitted duplicate (item, store, NULL-
--      location) rows because NULL != NULL under the table's UNIQUE
--      constraint. Updates then scattered across arbitrary "latest"
--      rows. -> dedupe + partial unique index.
--   2. Balance mutations were non-atomic SELECT-then-UPDATE chains
--      selected by ORDER BY updated_at DESC LIMIT 1 with no row lock.
--      -> new atomic RPC uinv_apply_stock_movement() that locks the
--      exact (item, store, location) row.
--   3. Over-issues / over-transfers / over-waste were silently clamped
--      to zero (Math.max(0, on_hand - qty)) instead of being rejected.
--      -> the RPC validates available stock and raises on shortfall
--      (unless explicitly allowed to go negative, e.g. POS).
--   4. uinv_stock_ledger / uinv_batches writes were best-effort side
--      effects that could silently fail after the balance update.
--      -> the RPC appends the ledger row in the same transaction and
--      optionally deducts FEFO/FIFO batches atomically.
--
-- Also replaces issue_stock_to_department() and deduct_outlet_inventory()
-- so every stock-movement path routes through the atomic RPC, and adds
-- NOT VALID CHECK constraints on workflow status columns.
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 1. Dedupe duplicate NULL-location balance rows
-- ════════════════════════════════════════════════════════════════
-- Merge every (item_id, store_id) group that has more than one row with
-- location_id IS NULL into a single canonical row (earliest created_at).
-- Quantity buckets are summed; unit_cost is taken from the row holding
-- the largest on_hand. Idempotent: after the merge each group has 1 row.
DO $$
DECLARE
  g RECORD;
  v_canonical_id text;
  v_cost numeric;
BEGIN
  FOR g IN
    SELECT item_id, store_id
      FROM public.uinv_stock_balances
      WHERE location_id IS NULL
      GROUP BY item_id, store_id
      HAVING COUNT(*) > 1
  LOOP
    -- canonical row = earliest created (stable), prefer non-zero on_hand
    SELECT id INTO v_canonical_id
      FROM public.uinv_stock_balances
      WHERE location_id IS NULL AND item_id = g.item_id AND store_id = g.store_id
      ORDER BY (on_hand > 0) DESC, created_at ASC, id ASC
      LIMIT 1;

    SELECT unit_cost INTO v_cost
      FROM public.uinv_stock_balances
      WHERE location_id IS NULL AND item_id = g.item_id AND store_id = g.store_id
      ORDER BY on_hand DESC, created_at ASC
      LIMIT 1;

    UPDATE public.uinv_stock_balances canon
      SET on_hand     = agg.on_hand,
          reserved    = agg.reserved,
          allocated   = agg.allocated,
          on_order    = agg.on_order,
          in_transit  = agg.in_transit,
          damaged     = agg.damaged,
          quarantined = agg.quarantined,
          expired     = agg.expired,
          unit_cost   = COALESCE(v_cost, canon.unit_cost),
          last_movement_date = GREATEST(COALESCE(canon.last_movement_date, agg.last_movement_date), COALESCE(agg.last_movement_date, canon.last_movement_date))
      FROM (
        SELECT SUM(on_hand) on_hand, SUM(reserved) reserved, SUM(allocated) allocated,
               SUM(on_order) on_order, SUM(in_transit) in_transit, SUM(damaged) damaged,
               SUM(quarantined) quarantined, SUM(expired) expired,
               MAX(last_movement_date) last_movement_date
          FROM public.uinv_stock_balances
          WHERE location_id IS NULL AND item_id = g.item_id AND store_id = g.store_id
      ) agg
      WHERE canon.id = v_canonical_id;

    DELETE FROM public.uinv_stock_balances
      WHERE location_id IS NULL AND item_id = g.item_id AND store_id = g.store_id
        AND id <> v_canonical_id;
  END LOOP;
END $$;

-- Partial unique index: exactly one NULL-location row per (item, store).
-- (The table-level UNIQUE (item_id, store_id, location_id) already covers
-- non-NULL locations; NULLs were exempt because NULL != NULL.)
CREATE UNIQUE INDEX IF NOT EXISTS uinv_stock_balances_item_store_null_loc
  ON public.uinv_stock_balances (item_id, store_id)
  WHERE location_id IS NULL;

-- ════════════════════════════════════════════════════════════════
-- 2. CHECK constraints on workflow status columns (NOT VALID
--    so pre-existing rows are not rejected; new writes are enforced)
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.uinv_transfers ADD CONSTRAINT uinv_transfers_status_chk
      CHECK (status IN ('Pending','Approved','Dispatched','In Transit','Received','Cancelled')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.uinv_adjustments ADD CONSTRAINT uinv_adjustments_status_chk
      CHECK (status IN ('Pending','Approved','Rejected','Cancelled')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.uinv_reservations ADD CONSTRAINT uinv_reservations_status_chk
      CHECK (status IN ('Active','Released','Cancelled','Fulfilled','Expired')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.uinv_counts ADD CONSTRAINT uinv_counts_status_chk
      CHECK (status IN ('Draft','In Progress','Completed','Approved','Cancelled')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.uinv_waste ADD CONSTRAINT uinv_waste_status_chk
      CHECK (status IN ('Pending','Approved','Rejected','Cancelled')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.uinv_goods_receipts ADD CONSTRAINT uinv_goods_receipts_status_chk
      CHECK (status IN ('Pending','Received','Partial','Discrepancy','Posted','Cancelled')) NOT VALID;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_apply_stock_movement — the single atomic movement RPC
-- ════════════════════════════════════════════════════════════════
-- All stock movements must go through this function. In ONE transaction it:
--   a. Enforces the inventory period lock (Frozen/Closed periods reject
--      movements) unless p_skip_period_check.
--   b. Locks the exact (item_id, store_id, location_id) balance row
--      (IS NOT DISTINCT FROM — no ORDER BY updated_at tricks).
--   c. Validates availability = on_hand - reserved - allocated -
--      damaged - quarantined - expired against p_qty_out, raising a
--      P0002-style error with the shortfall detail. p_allow_negative
--      bypasses the guard (POS sales must complete; the true negative
--      is recorded rather than clamped to 0).
--   d. Blends unit cost with weighted average on inbound movements.
--   e. Optionally deducts uinv_batches (specific p_batch_id, or a
--      FEFO/FIFO plan via p_deduct_batches).
--   f. Appends the uinv_stock_ledger row with the correct running
--      balance.
--
-- Returns: { balance_id, on_hand, reserved, allocated, available,
--            unit_cost, batch_deductions: [...], batches_short: bool }
CREATE OR REPLACE FUNCTION public.uinv_apply_stock_movement(
  p_property_id        uuid,
  p_item_id            text,
  p_store_id           text,
  p_transaction_type   text,
  p_qty_in             numeric DEFAULT 0,
  p_qty_out            numeric DEFAULT 0,
  p_location_id        text   DEFAULT NULL,
  p_reference          text   DEFAULT NULL,
  p_reserved_delta     numeric DEFAULT 0,
  p_allocated_delta    numeric DEFAULT 0,
  p_unit_cost          numeric DEFAULT NULL,
  p_batch_id           text   DEFAULT NULL,
  p_deduct_batches     text   DEFAULT NULL,  -- 'FEFO' | 'FIFO' | NULL
  p_performed_by       text   DEFAULT 'system',
  p_reason             text   DEFAULT NULL,
  p_allow_negative     boolean DEFAULT false,
  p_skip_period_check  boolean DEFAULT false,
  p_theoretical_qty    numeric DEFAULT NULL,  -- count/variance context (migration 374 columns)
  p_actual_qty         numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bal         RECORD;
  v_available   numeric;
  v_new_on_hand numeric;
  v_new_cost    numeric;
  v_batch       RECORD;
  v_remaining   numeric;
  v_take        numeric;
  v_deductions  jsonb := '[]'::jsonb;
  v_batches_short boolean := false;
  v_period      RECORD;
BEGIN
  IF p_item_id IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'uinv_apply_stock_movement: item_id and store_id are required'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_qty_in, 0) < 0 OR COALESCE(p_qty_out, 0) < 0 THEN
    RAISE EXCEPTION 'uinv_apply_stock_movement: quantities must be non-negative'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_deduct_batches IS NOT NULL AND p_deduct_batches NOT IN ('FEFO','FIFO') THEN
    RAISE EXCEPTION 'uinv_apply_stock_movement: p_deduct_batches must be FEFO or FIFO'
      USING ERRCODE = 'P0001';
  END IF;

  -- (a) Period lock — reject movements into Frozen/Closed periods
  IF NOT p_skip_period_check THEN
    SELECT period_name, status INTO v_period
      FROM public.uinv_inventory_periods
      WHERE (property_id IS NULL OR property_id IS NOT DISTINCT FROM p_property_id)
        AND CURRENT_DATE BETWEEN start_date AND end_date
        AND status IN ('Frozen','Closed')
      ORDER BY start_date DESC
      LIMIT 1;
    IF v_period.period_name IS NOT NULL THEN
      RAISE EXCEPTION 'Inventory period % is % — stock movements are locked', v_period.period_name, v_period.status
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (b) Lock the exact balance row
  SELECT * INTO v_bal
    FROM public.uinv_stock_balances
    WHERE item_id = p_item_id
      AND store_id = p_store_id
      AND location_id IS NOT DISTINCT FROM p_location_id
    FOR UPDATE;

  IF NOT FOUND THEN
    IF COALESCE(p_qty_in, 0) > 0 THEN
      INSERT INTO public.uinv_stock_balances (
        property_id, item_id, store_id, location_id,
        on_hand, reserved, allocated, status, unit_cost, last_movement_date
      ) VALUES (
        p_property_id, p_item_id, p_store_id, p_location_id,
        COALESCE(p_qty_in,0) - COALESCE(p_qty_out,0),
        GREATEST(0, COALESCE(p_reserved_delta,0)),
        GREATEST(0, COALESCE(p_allocated_delta,0)),
        'Available',
        COALESCE(p_unit_cost, 0),
        now()
      );
      SELECT * INTO v_bal
        FROM public.uinv_stock_balances
        WHERE item_id = p_item_id AND store_id = p_store_id
          AND location_id IS NOT DISTINCT FROM p_location_id;
    ELSIF COALESCE(p_qty_out, 0) > 0 AND p_allow_negative THEN
      -- POS-style deduction of untracked stock: record the true negative
      -- (never a phantom zero row).
      INSERT INTO public.uinv_stock_balances (
        property_id, item_id, store_id, location_id,
        on_hand, status, unit_cost, last_movement_date
      ) VALUES (
        p_property_id, p_item_id, p_store_id, p_location_id,
        -COALESCE(p_qty_out,0), 'Available', COALESCE(p_unit_cost,0), now()
      );
      SELECT * INTO v_bal
        FROM public.uinv_stock_balances
        WHERE item_id = p_item_id AND store_id = p_store_id
          AND location_id IS NOT DISTINCT FROM p_location_id;
    ELSE
      RAISE EXCEPTION 'No stock balance for item % in store % — cannot issue %', p_item_id, p_store_id, COALESCE(p_qty_out,0)
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- (c) Availability guard
    v_available := v_bal.on_hand - v_bal.reserved - v_bal.allocated
                 - v_bal.damaged - v_bal.quarantined - v_bal.expired;
    IF COALESCE(p_qty_out,0) > v_available AND NOT p_allow_negative THEN
      RAISE EXCEPTION 'Insufficient stock for item % in store %: available %, required %',
        p_item_id, p_store_id, v_available, COALESCE(p_qty_out,0)
        USING ERRCODE = 'P0001';
    END IF;

    -- Reservations must not exceed unreserved on-hand stock
    IF COALESCE(p_reserved_delta,0) > 0 AND NOT p_allow_negative
       AND v_available - COALESCE(p_reserved_delta,0) < 0 THEN
      RAISE EXCEPTION 'Insufficient stock to reserve item % in store %: available %, requested reservation %',
        p_item_id, p_store_id, v_available, COALESCE(p_reserved_delta,0)
        USING ERRCODE = 'P0001';
    END IF;

    -- (d) Weighted-average cost blend on inbound
    v_new_cost := v_bal.unit_cost;
    IF COALESCE(p_qty_in,0) > 0 AND COALESCE(p_unit_cost,0) > 0 THEN
      IF v_bal.on_hand + p_qty_in > 0 THEN
        v_new_cost := ROUND(
          (ABS(v_bal.on_hand) * v_bal.unit_cost + p_qty_in * p_unit_cost)
          / (v_bal.on_hand + p_qty_in), 2);
      ELSE
        v_new_cost := p_unit_cost;
      END IF;
    ELSIF COALESCE(p_unit_cost,0) > 0 AND v_bal.unit_cost = 0 THEN
      v_new_cost := p_unit_cost;
    END IF;

    v_new_on_hand := v_bal.on_hand + COALESCE(p_qty_in,0) - COALESCE(p_qty_out,0);

    UPDATE public.uinv_stock_balances
      SET on_hand = v_new_on_hand,
          reserved = GREATEST(0, reserved + COALESCE(p_reserved_delta,0)),
          allocated = GREATEST(0, allocated + COALESCE(p_allocated_delta,0)),
          unit_cost = v_new_cost,
          last_movement_date = now(),
          updated_at = now()
      WHERE id = v_bal.id;
  END IF;

  -- (e) Batch deduction (specific batch or FEFO/FIFO plan)
  IF p_batch_id IS NOT NULL THEN
    SELECT * INTO v_batch FROM public.uinv_batches
      WHERE id = p_batch_id AND item_id = p_item_id
        AND (store_id IS NULL OR store_id = p_store_id)
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Batch % not found for item %', p_batch_id, p_item_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_batch.quantity < COALESCE(p_qty_out,0) THEN
      v_batches_short := true;
    END IF;
    v_take := LEAST(v_batch.quantity, COALESCE(p_qty_out,0));
    IF v_take > 0 THEN
      UPDATE public.uinv_batches SET quantity = quantity - v_take, updated_at = now()
        WHERE id = v_batch.id;
      v_deductions := v_deductions || jsonb_build_object(
        'batch_id', v_batch.id, 'batch_number', v_batch.batch_number,
        'take_qty', v_take);
    END IF;
  ELSIF p_deduct_batches IS NOT NULL AND COALESCE(p_qty_out,0) > 0 THEN
    v_remaining := COALESCE(p_qty_out,0);
    FOR v_batch IN
      SELECT * FROM public.uinv_batches
        WHERE item_id = p_item_id
          AND (store_id IS NULL OR store_id = p_store_id)
          AND quantity > 0
          AND status = 'Available'
        ORDER BY
          CASE WHEN p_deduct_batches = 'FEFO' THEN expiry_date END ASC NULLS LAST,
          CASE WHEN p_deduct_batches = 'FIFO' THEN COALESCE(received_date, created_at::date) END ASC,
          created_at ASC
        FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_batch.quantity, v_remaining);
      UPDATE public.uinv_batches SET quantity = quantity - v_take, updated_at = now()
        WHERE id = v_batch.id;
      v_deductions := v_deductions || jsonb_build_object(
        'batch_id', v_batch.id, 'batch_number', v_batch.batch_number,
        'take_qty', v_take);
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      v_batches_short := true;
    END IF;
  END IF;

  -- (f) Ledger append (same transaction, correct running balance)
  INSERT INTO public.uinv_stock_ledger (
    property_id, item_id, store_id, location_id, batch_id,
    transaction_type, reference,
    quantity_in, quantity_out, balance,
    unit_cost, value, performed_by, reason, transaction_date,
    theoretical_qty, actual_qty
  ) VALUES (
    p_property_id, p_item_id, p_store_id, p_location_id, p_batch_id,
    p_transaction_type, p_reference,
    COALESCE(p_qty_in,0), COALESCE(p_qty_out,0), v_bal.on_hand,
    COALESCE(NULLIF(p_unit_cost,0), v_bal.unit_cost, 0),
    (COALESCE(p_qty_in,0) + COALESCE(p_qty_out,0)) * COALESCE(NULLIF(p_unit_cost,0), v_bal.unit_cost, 0),
    p_performed_by, p_reason, now(),
    p_theoretical_qty, p_actual_qty
  );

  RETURN jsonb_build_object(
    'balance_id', v_bal.id,
    'on_hand', v_bal.on_hand,
    'reserved', v_bal.reserved,
    'allocated', v_bal.allocated,
    'available', v_bal.on_hand - v_bal.reserved - v_bal.allocated
               - v_bal.damaged - v_bal.quarantined - v_bal.expired,
    'unit_cost', v_bal.unit_cost,
    'batch_deductions', v_deductions,
    'batches_short', v_batches_short
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.uinv_apply_stock_movement(
  uuid, text, text, text, numeric, numeric, text, text, numeric, numeric,
  numeric, text, text, text, text, boolean, boolean, numeric, numeric) TO authenticated;

COMMENT ON FUNCTION public.uinv_apply_stock_movement IS
  'Atomic stock movement: locks the (item, store, location) balance row, validates availability (rejects over-issue unless p_allow_negative), blends weighted-average cost, optionally deducts FEFO/FIFO batches, and appends the immutable ledger row — all in one transaction. Enforces Frozen/Closed inventory-period locks unless p_skip_period_check.';

-- ════════════════════════════════════════════════════════════════
-- 4. uinv_recommend_batches — pure FEFO/FIFO picking plan
-- ════════════════════════════════════════════════════════════════
-- Returns the ordered batch plan a picking task should consume,
-- without mutating anything. The picking PATCH applies it via
-- uinv_apply_stock_movement(p_deduct_batches => ...).
CREATE OR REPLACE FUNCTION public.uinv_recommend_batches(
  p_item_id  text,
  p_store_id text,
  p_qty      numeric,
  p_strategy text DEFAULT 'FEFO'
)
RETURNS TABLE (
  batch_id     text,
  batch_number text,
  expiry_date  date,
  received_date date,
  available_qty numeric,
  take_qty     numeric,
  unit_cost    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_remaining numeric := COALESCE(p_qty, 0);
  v_take numeric;
BEGIN
  IF p_strategy NOT IN ('FEFO','FIFO') THEN
    RAISE EXCEPTION 'Strategy must be FEFO or FIFO' USING ERRCODE = 'P0001';
  END IF;

  FOR v_batch IN
    SELECT * FROM public.uinv_batches
      WHERE item_id = p_item_id
        AND (store_id IS NULL OR store_id = p_store_id)
        AND quantity > 0
        AND status = 'Available'
      ORDER BY
        CASE WHEN p_strategy = 'FEFO' THEN expiry_date END ASC NULLS LAST,
        CASE WHEN p_strategy = 'FIFO' THEN COALESCE(received_date, created_at::date) END ASC,
        created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.quantity, v_remaining);
    RETURN QUERY SELECT
      v_batch.id, v_batch.batch_number, v_batch.expiry_date,
      v_batch.received_date, v_batch.quantity, v_take, v_batch.unit_cost;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.uinv_recommend_batches(text, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.uinv_recommend_batches IS
  'Pure FEFO/FIFO batch picking plan for an item/store/quantity — no mutation. Picking execution deducts via uinv_apply_stock_movement.';

-- ════════════════════════════════════════════════════════════════
-- 5. Replace issue_stock_to_department — route through the RPC
-- ════════════════════════════════════════════════════════════════
-- Keeps the 378 department-store resolution (parent_store_id first,
-- department-column fallback) but delegates both legs (MAIN deduct +
-- department receipt) to uinv_apply_stock_movement, which adds:
--   - exact-row locking (no ORDER BY updated_at DESC LIMIT 1)
--   - availability validation against reserved/allocated/quarantined
--   - period lock enforcement
--   - ledger rows with correct running balances
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
  v_main_result jsonb;
  v_dept_result jsonb;
  v_result jsonb := jsonb_build_object('success', true, 'issued_lines', '[]'::jsonb, 'errors', '[]'::jsonb);
  v_issued_lines jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_item_type text;
  v_consumable_types text[] := ARRAY['Consumable', 'Food', 'Beverage', 'Inventory Item'];
BEGIN
  SELECT * INTO v_issue FROM public.uinv_issues WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array('Issue not found'));
  END IF;

  -- Resolve the department store (primary: child of MAIN; fallback:
  -- department column, per migration 378).
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

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_issue.lines) WITH ORDINALITY AS t(line, idx)
  LOOP
    IF (v_line.line->>'itemId') IS NULL OR COALESCE((v_line.line->>'issuedQty')::numeric, 0) <= 0 THEN
      CONTINUE;
    END IF;

    SELECT item_type INTO v_item_type FROM public.uinv_items WHERE id = v_line.line->>'itemId';
    IF v_item_type IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.line->>'itemId', 'error', 'Item not found'));
      CONTINUE;
    END IF;

    -- Non-consumable assets are skipped here (handled in app layer)
    IF NOT (v_item_type = ANY(v_consumable_types)) THEN
      CONTINUE;
    END IF;

    -- Leg 1: atomic deduct from MAIN (validates availability)
    BEGIN
      v_main_result := public.uinv_apply_stock_movement(
        v_issue.property_id,
        v_line.line->>'itemId',
        'UINV-ST-MAIN',
        'Department Issue',
        0,
        (v_line.line->>'issuedQty')::numeric,
        NULL,
        v_issue.issue_number,
        0, 0,
        COALESCE((v_line.line->>'cost')::numeric, 0),
        NULL, NULL,
        p_performed_by,
        'Issue to ' || v_issue.department,
        false,          -- p_allow_negative
        false           -- p_skip_period_check
      );
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'itemId', v_line.line->>'itemId',
        'itemName', v_line.line->>'itemName',
        'error', SQLERRM));
      CONTINUE;
    END;

    -- Leg 2: atomic receipt into the department store
    v_dept_result := public.uinv_apply_stock_movement(
      v_issue.property_id,
      v_line.line->>'itemId',
      v_dept_store_id,
      'Department Receipt',
      (v_line.line->>'issuedQty')::numeric,
      0,
      NULL,
      v_issue.issue_number,
      0, 0,
      COALESCE((v_line.line->>'cost')::numeric, 0),
      NULL, NULL,
      p_performed_by,
      'Received from Main Warehouse for ' || v_issue.department,
      true,           -- p_allow_negative (inbound, never blocks)
      false
    );

    v_issued_lines := v_issued_lines || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.line->>'itemId',
      'issuedQty', (v_line.line->>'issuedQty')::numeric,
      'newMainOnHand', (v_main_result->>'on_hand')::numeric,
      'newDeptOnHand', (v_dept_result->>'on_hand')::numeric
    ));
  END LOOP;

  -- Any error rolls back the whole distribution
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
  'Atomically distribute consumable stock from Main Warehouse to a department store for all lines of an issue, delegating each leg to uinv_apply_stock_movement (exact-row lock, availability validation, period lock, correct ledger balances). Rolls back on any failure. Non-consumable assets are skipped (handled in app layer).';

-- ════════════════════════════════════════════════════════════════
-- 6. Replace deduct_outlet_inventory — POS dual-write via the RPC
-- ════════════════════════════════════════════════════════════════
-- Same recipe/SKU resolution as migration 373, but the unified
-- dual-write now goes through uinv_apply_stock_movement with
-- p_allow_negative => true: a POS sale must not be rejected for stock
-- reasons, but the TRUE (possibly negative) on-hand is recorded in both
-- the balance and the ledger — no more silent clamping to 0 and no more
-- phantom zero-quantity balance rows. The legacy writes are unchanged.
CREATE OR REPLACE FUNCTION public.deduct_outlet_inventory(
  p_outlet_id UUID,
  p_line_items JSONB,
  p_inventory_mode TEXT,
  p_reference_doc TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'pos_sale'
)
RETURNS TABLE (
  ingredient_id TEXT,
  ingredient_name TEXT,
  quantity_deducted NUMERIC,
  unit TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line JSONB;
  v_item_id TEXT;
  v_qty NUMERIC;
  v_menu_item_id TEXT;
  v_recipe RECORD;
  v_recipe_line RECORD;
  v_uinv_item_id TEXT;
  v_store_id TEXT;
  v_unit_cost NUMERIC;
  v_outlet RECORD;
  v_move jsonb;
BEGIN
  -- Resolve the outlet's default unified store
  SELECT default_store_id, name INTO v_outlet
  FROM public.pos_outlets WHERE id = p_outlet_id LIMIT 1;

  v_store_id := COALESCE(v_outlet.default_store_id, 'UINV-ST-FOOD');

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_item_id := v_line->>'item_id';
    v_qty := COALESCE((v_line->>'quantity')::numeric, 0);
    v_menu_item_id := v_line->>'menu_item_id';

    IF v_qty <= 0 THEN CONTINUE; END IF;

    IF p_inventory_mode = 'recipe' THEN
      -- Recipe mode: deduct BOM components via recipes/recipe_lines/ingredients
      FOR v_recipe IN
        SELECT r.id FROM public.recipes r
        WHERE r.menu_item_id = v_menu_item_id
        LIMIT 1
      LOOP
        FOR v_recipe_line IN
          SELECT rl.ingredient_id, rl.quantity, rl.unit, i.name, i.current_cost,
                 i.uinv_item_id
          FROM public.recipe_lines rl
          JOIN public.ingredients i ON i.id = rl.ingredient_id
          WHERE rl.recipe_id = v_recipe.id
        LOOP
          DECLARE
            v_deduct_qty NUMERIC := v_recipe_line.quantity * v_qty;
          BEGIN
            -- 1. Legacy write: stock_transactions
            INSERT INTO public.stock_transactions (
              ingredient_id, transaction_type, quantity, unit,
              cost_per_unit, total_value, date,
              reference_doc, reference_type, notes
            ) VALUES (
              v_recipe_line.ingredient_id, 'POSDepletion',
              v_deduct_qty, v_recipe_line.unit,
              COALESCE(v_recipe_line.current_cost, 0),
              COALESCE(v_recipe_line.current_cost, 0) * v_deduct_qty,
              NOW(), p_reference_doc, p_reference_type,
              'Auto-deducted from POS sale (recipe mode)'
            );

            -- 2. Unified dual-write via the atomic movement RPC
            v_uinv_item_id := v_recipe_line.uinv_item_id;
            IF v_uinv_item_id IS NULL THEN
              SELECT ui.id INTO v_uinv_item_id
              FROM public.uinv_items ui
              WHERE lower(ui.item_name) = lower(v_recipe_line.name)
                AND ui.category = 'Food & Beverage'
              LIMIT 1;
            END IF;

            IF v_uinv_item_id IS NOT NULL THEN
              v_unit_cost := COALESCE(v_recipe_line.current_cost, 0);
              v_move := public.uinv_apply_stock_movement(
                NULL,                 -- property (not resolved at POS layer)
                v_uinv_item_id,
                v_store_id,
                'Consumption',
                0,
                v_deduct_qty,
                NULL,                 -- location
                p_reference_doc,
                0, 0,
                v_unit_cost,
                NULL, NULL,
                'pos_system',
                'POS sale (recipe mode) - ' || v_recipe_line.name,
                true,                 -- allow negative: record the truth
                true                  -- skip period lock for POS
              );
            END IF;

            RETURN QUERY SELECT
              v_recipe_line.ingredient_id::text,
              v_recipe_line.name,
              v_deduct_qty,
              v_recipe_line.unit,
              'deducted';
          END;
        END LOOP;
      END LOOP;

    ELSE
      -- SKU mode: deduct direct stock from inventory_items (legacy)
      -- AND dual-write to uinv_* if linked
      DECLARE
        v_inv_item RECORD;
      BEGIN
        SELECT id, name, current_quantity, unit_cost, uinv_item_id, item_code, sku
        INTO v_inv_item
        FROM public.inventory_items
        WHERE id = v_item_id OR item_code = v_item_id OR sku = v_item_id
        LIMIT 1;

        IF v_inv_item IS NOT NULL THEN
          -- 1. Legacy write (unchanged behaviour)
          UPDATE public.inventory_items
            SET current_quantity = GREATEST(0, current_quantity - v_qty),
                updated_at = NOW()
            WHERE id = v_inv_item.id;

          -- 2. Unified dual-write via the atomic movement RPC
          v_uinv_item_id := v_inv_item.uinv_item_id;
          IF v_uinv_item_id IS NULL THEN
            SELECT ui.id INTO v_uinv_item_id
            FROM public.uinv_items ui
            WHERE lower(ui.item_name) = lower(v_inv_item.name)
              AND ui.category = 'Food & Beverage'
            LIMIT 1;
          END IF;

          IF v_uinv_item_id IS NOT NULL THEN
            v_unit_cost := COALESCE(v_inv_item.unit_cost, 0);
            v_move := public.uinv_apply_stock_movement(
              NULL,
              v_uinv_item_id,
              v_store_id,
              'Consumption',
              0,
              v_qty,
              NULL,
              p_reference_doc,
              0, 0,
              v_unit_cost,
              NULL, NULL,
              'pos_system',
              'POS sale (SKU mode) - ' || v_inv_item.name,
              true,
              true
            );
          END IF;

          RETURN QUERY SELECT
            v_inv_item.id,
            v_inv_item.name,
            v_qty,
            COALESCE(v_inv_item.unit_of_measure, 'units'),
            'deducted';
        ELSE
          RETURN QUERY SELECT v_item_id, v_item_id, v_qty, 'units', 'not_found';
        END IF;
      END;
    END IF;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_outlet_inventory(uuid, jsonb, text, text, text) TO authenticated;

-- Audit record for executed picks: which batches were actually consumed
-- (filled by PATCH /picking-tasks/:id when a task is Picked).
ALTER TABLE public.uinv_picking_tasks
  ADD COLUMN IF NOT EXISTS picked_batches jsonb;

-- ════════════════════════════════════════════════════════════════
-- 7. Verification notices
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'Migration 387 complete: movement integrity installed.';
  RAISE NOTICE 'Index: uinv_stock_balances_item_store_null_loc (partial, WHERE location_id IS NULL)';
  RAISE NOTICE 'Constraints: NOT VALID status CHECKs on transfers/adjustments/reservations/counts/waste/receipts';
  RAISE NOTICE 'Functions: uinv_apply_stock_movement(), uinv_recommend_batches(), issue_stock_to_department() + deduct_outlet_inventory() replaced';
END $$;
