-- ════════════════════════════════════════════════════════════════
-- Migration 376: Central Store Dynamic Par (Min / ROP / Par Level)
-- ════════════════════════════════════════════════════════════════
-- Implements the Central Store ROP formula:
--
--   ROP_Central = (D_Total × LT_Vendor) + SS_Central
--
-- Where:
--   D_Total   = combined average daily usage across ALL department stores
--   LT_Vendor = vendor lead time (external supplier → central shelf)
--   SS_Central = central safety stock — two configurable methods:
--      • 'bulletproof'  : SS = Σ (Par_dept − ROP_dept)   [zero risk]
--      • 'statistical'  : SS = Z × √(LT×σ²_D + D²×σ²_LT) [standard risk]
--
-- Also derives:
--   Central Min  = SS_Central              (the floor buffer)
--   Central Par  = ROP_Central + OrderQty, enforced > Σ Par_dept
--      OrderQty (bulletproof) = Σ (Par_dept − ROP_dept)
--      OrderQty (statistical) = D_Total × reorder_cycle_days
--
-- Components:
--   1. Adds central-specific config columns to uinv_dynamic_par_config.
--   2. uinv_central_store_stats — cached per-item central calculations.
--   3. refresh_central_store_stats() — aggregates dept consumption stats,
--      computes central Min/ROP/Par, updates stock balances + item master.
--   4. pg_cron schedule for daily recalculation.
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 1. Extend uinv_dynamic_par_config with central-store columns
-- ════════════════════════════════════════════════════════════════
-- For config rows scoped to the Main Warehouse (store_id = 'UINV-ST-MAIN'):
--   • lead_time_days  → vendor lead time (external supplier → central)
--   • safety_stock_method → 'bulletproof' (default) | 'statistical'
--   • lead_time_stddev_days → σ_LT for the statistical formula (default 0)
-- These columns are nullable / defaulted so existing dept configs are
-- unaffected (dept rows leave them at default).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.uinv_dynamic_par_config
  ADD COLUMN IF NOT EXISTS safety_stock_method text NOT NULL DEFAULT 'bulletproof'
    CHECK (safety_stock_method IN ('bulletproof', 'statistical'));

ALTER TABLE public.uinv_dynamic_par_config
  ADD COLUMN IF NOT EXISTS lead_time_stddev_days numeric(8,3) NOT NULL DEFAULT 0;

-- Seed a Main-Warehouse-level default config (store_id = MAIN, item_id NULL)
-- so the central calculation has a vendor lead time to use out of the box.
INSERT INTO public.uinv_dynamic_par_config
  (store_id, item_id, lookback_days, lead_time_days, safety_stock_days,
   reorder_cycle_days, service_level, is_enabled, safety_stock_method, lead_time_stddev_days)
VALUES ('UINV-ST-MAIN', NULL, 30, 5, 3, 7, 0.95, true, 'bulletproof', 0)
ON CONFLICT (store_id, item_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_central_store_stats — cached central dynamic par per item
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_central_store_stats (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  lookback_days int NOT NULL DEFAULT 30,
  -- Total daily demand across all department stores
  d_total numeric(12,3) NOT NULL DEFAULT 0,
  -- Combined demand variance (σ²_D) across dept stores
  demand_variance numeric(14,6) NOT NULL DEFAULT 0,
  -- Number of department stores contributing demand
  dept_count int NOT NULL DEFAULT 0,
  -- Vendor lead time used (days)
  vendor_lead_time_days numeric(8,3) NOT NULL DEFAULT 0,
  -- Lead time stddev used (σ_LT)
  lead_time_stddev_days numeric(8,3) NOT NULL DEFAULT 0,
  -- Safety stock method + computed value
  safety_stock_method text NOT NULL DEFAULT 'bulletproof',
  ss_central numeric(12,3) NOT NULL DEFAULT 0,
  -- Central Min = SS_Central (the floor buffer)
  central_min numeric(12,3) NOT NULL DEFAULT 0,
  -- Central ROP = (D_Total × LT_Vendor) + SS_Central
  central_rop numeric(12,3) NOT NULL DEFAULT 0,
  -- Central order quantity (refill amount from vendor)
  central_order_qty numeric(12,3) NOT NULL DEFAULT 0,
  -- Central Par = ROP + OrderQty (enforced > combined dept par)
  central_par numeric(12,3) NOT NULL DEFAULT 0,
  -- Combined department par / rop (for transparency)
  combined_dept_par numeric(12,3) NOT NULL DEFAULT 0,
  combined_dept_rop numeric(12,3) NOT NULL DEFAULT 0,
  -- Service level + z-score used
  service_level numeric(5,2) NOT NULL DEFAULT 0.95,
  z_score numeric(5,2) NOT NULL DEFAULT 1.65,
  -- Per-department breakdown for auditability
  dept_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, lookback_days)
);

CREATE INDEX IF NOT EXISTS idx_uinv_central_stats_item
  ON public.uinv_central_store_stats(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_central_stats_lookback
  ON public.uinv_central_store_stats(lookback_days);

ALTER TABLE public.uinv_central_store_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read uinv_central_store_stats"
  ON public.uinv_central_store_stats FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "authenticated can manage uinv_central_store_stats"
  ON public.uinv_central_store_stats FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_central_store_stats"
  ON public.uinv_central_store_stats FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_central_store_stats TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. refresh_central_store_stats() — the central dynamic par engine
-- ════════════════════════════════════════════════════════════════
-- Steps:
--   a. Refresh department consumption stats (ensures dept avg_daily /
--      dynamic par are current).
--   b. For every item that has dept consumption OR a Main balance:
--        D_Total   = Σ dept avg_daily_consumption
--        σ²_D      = Σ dept (consumption_stddev²)
--        LT_Vendor = config(item > MAIN-store > global) lead_time_days
--        SS_Central =
--          bulletproof : Σ (dept dynamic_par − dept dynamic_replenish_min)
--          statistical : Z × √(LT × σ²_D + D² × σ²_LT)
--        Central Min = SS_Central
--        Central ROP = D_Total × LT_Vendor + SS_Central
--        OrderQty    =
--          bulletproof : Σ (dept par − dept rop)
--          statistical : D_Total × reorder_cycle_days
--        Central Par = max(ROP + OrderQty, Σ dept par + 1)
--   c. Upsert into uinv_central_store_stats.
--   d. Update uinv_stock_balances (store = MAIN) replenish_min/max.
--   e. Update uinv_items reorder_point / par_level / min_stock so the
--      procurement auto-trigger (which reads item-level thresholds) sees
--      the central values.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refresh_central_store_stats(
  p_lookback_days int DEFAULT 30,
  p_property_id uuid DEFAULT NULL
)
RETURNS TABLE (
  item_id text,
  d_total numeric,
  central_min numeric,
  central_rop numeric,
  central_par numeric,
  ss_method text,
  dept_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global_lt int;
  v_global_safety int;
  v_global_cycle int;
  v_global_service numeric;
  v_global_method text;
  v_global_lt_stddev numeric;
  v_main_lt int;
  v_main_safety int;
  v_main_cycle int;
  v_main_service numeric;
  v_main_method text;
  v_main_lt_stddev numeric;
  v_z numeric;
  r RECORD;
  v_ss numeric;
  v_order_qty numeric;
  v_par numeric;
  v_combined_dept_par numeric;
  v_combined_dept_rop numeric;
  v_demand_variance numeric;
  v_dept_breakdown jsonb;
BEGIN
  -- a. Refresh department consumption stats first so dept avg_daily /
  --    dynamic par are fresh. (refresh_consumption_stats covers all stores;
  --    the central aggregation below excludes MAIN.)
  PERFORM * FROM public.refresh_consumption_stats(p_lookback_days, p_property_id);

  -- Global config defaults (store_id NULL, item_id NULL)
  SELECT
    COALESCE(lead_time_days, 5),
    COALESCE(safety_stock_days, 3),
    COALESCE(reorder_cycle_days, 7),
    COALESCE(service_level, 0.95),
    COALESCE(safety_stock_method, 'bulletproof'),
    COALESCE(lead_time_stddev_days, 0)
  INTO v_global_lt, v_global_safety, v_global_cycle, v_global_service,
       v_global_method, v_global_lt_stddev
  FROM public.uinv_dynamic_par_config
  WHERE store_id IS NULL AND item_id IS NULL
  LIMIT 1;

  -- Main-store-level config defaults (store_id = MAIN, item_id NULL)
  SELECT
    COALESCE(lead_time_days, v_global_lt),
    COALESCE(safety_stock_days, v_global_safety),
    COALESCE(reorder_cycle_days, v_global_cycle),
    COALESCE(service_level, v_global_service),
    COALESCE(safety_stock_method, v_global_method),
    COALESCE(lead_time_stddev_days, v_global_lt_stddev)
  INTO v_main_lt, v_main_safety, v_main_cycle, v_main_service,
       v_main_method, v_main_lt_stddev
  FROM public.uinv_dynamic_par_config
  WHERE store_id = 'UINV-ST-MAIN' AND item_id IS NULL AND is_enabled = true
  LIMIT 1;
  IF NOT FOUND THEN
    v_main_lt := v_global_lt;
    v_main_safety := v_global_safety;
    v_main_cycle := v_global_cycle;
    v_main_service := v_global_service;
    v_main_method := v_global_method;
    v_main_lt_stddev := v_global_lt_stddev;
  END IF;

  -- Clear old central stats for this lookback
  DELETE FROM public.uinv_central_store_stats
  WHERE lookback_days = p_lookback_days
    AND (p_property_id IS NULL OR property_id = p_property_id);

  -- b. Aggregate per item across all department stores (store_id != MAIN)
  FOR r IN
    SELECT
      cs.item_id,
      MAX(cs.property_id) AS property_id,
      SUM(cs.avg_daily_consumption) AS d_total,
      SUM(cs.consumption_stddev * cs.consumption_stddev) AS demand_variance,
      SUM(cs.dynamic_par_level) AS combined_dept_par,
      SUM(cs.dynamic_replenish_min) AS combined_dept_rop,
      SUM(GREATEST(cs.dynamic_par_level - cs.dynamic_replenish_min, 0)) AS combined_dept_order_qty,
      COUNT(*) AS dept_count,
      jsonb_agg(jsonb_build_object(
        'storeId', cs.store_id,
        'storeName', s.store_name,
        'department', s.department,
        'avgDaily', cs.avg_daily_consumption,
        'dynamicPar', cs.dynamic_par_level,
        'dynamicMin', cs.dynamic_replenish_min,
        'orderQty', GREATEST(cs.dynamic_par_level - cs.dynamic_replenish_min, 0)
      ) ORDER BY s.store_name) AS dept_breakdown
    FROM public.uinv_consumption_stats cs
    JOIN public.uinv_stores s ON s.id = cs.store_id
    WHERE cs.lookback_days = p_lookback_days
      AND cs.store_id <> 'UINV-ST-MAIN'
      AND (p_property_id IS NULL OR cs.property_id = p_property_id)
    GROUP BY cs.item_id
  LOOP
    -- Resolve item-specific central config (store_id = MAIN, item_id = r.item_id)
    DECLARE
      v_item_lt int;
      v_item_cycle int;
      v_item_service numeric;
      v_item_method text;
      v_item_lt_stddev numeric;
      v_lt numeric;
      v_cycle int;
      v_service numeric;
      v_method text;
      v_lt_stddev numeric;
    BEGIN
      SELECT
        COALESCE(lead_time_days, v_main_lt),
        COALESCE(reorder_cycle_days, v_main_cycle),
        COALESCE(service_level, v_main_service),
        COALESCE(safety_stock_method, v_main_method),
        COALESCE(lead_time_stddev_days, v_main_lt_stddev)
      INTO v_item_lt, v_item_cycle, v_item_service, v_item_method, v_item_lt_stddev
      FROM public.uinv_dynamic_par_config
      WHERE store_id = 'UINV-ST-MAIN' AND item_id = r.item_id AND is_enabled = true
      LIMIT 1;

      v_lt        := COALESCE(v_item_lt, v_main_lt);
      v_cycle     := COALESCE(v_item_cycle, v_main_cycle);
      v_service   := COALESCE(v_item_service, v_main_service);
      v_method    := COALESCE(v_item_method, v_main_method);
      v_lt_stddev := COALESCE(v_item_lt_stddev, v_main_lt_stddev);

      -- Z-score for service level
      v_z := CASE
        WHEN v_service >= 0.99 THEN 2.33
        WHEN v_service >= 0.95 THEN 1.65
        WHEN v_service >= 0.90 THEN 1.28
        ELSE 1.65
      END;

      v_demand_variance := COALESCE(r.demand_variance, 0);
      v_combined_dept_par := COALESCE(r.combined_dept_par, 0);
      v_combined_dept_rop := COALESCE(r.combined_dept_rop, 0);

      -- Safety stock
      IF v_method = 'statistical' THEN
        v_ss := v_z * SQRT(
          v_lt * v_demand_variance +
          (r.d_total * r.d_total) * (v_lt_stddev * v_lt_stddev)
        );
      ELSE
        -- bulletproof: sum of dept order quantities
        v_ss := COALESCE(r.combined_dept_order_qty, 0);
      END IF;

      -- Central Min = SS_Central
      -- Central ROP = (D_Total × LT_Vendor) + SS_Central
      -- OrderQty: bulletproof = Σ dept order qty; statistical = D × cycle
      -- Central Par = max(ROP + OrderQty, combined_dept_par + 1)
      IF v_method = 'statistical' THEN
        v_order_qty := r.d_total * v_cycle;
      ELSE
        v_order_qty := COALESCE(r.combined_dept_order_qty, 0);
      END IF;

      v_par := (r.d_total * v_lt) + v_ss + v_order_qty;
      -- Enforce Par strictly larger than combined dept par levels
      IF v_par <= v_combined_dept_par THEN
        v_par := v_combined_dept_par + 1;
      END IF;

      -- Round to 1 decimal
      v_ss        := ROUND(v_ss, 1);
      v_order_qty := ROUND(v_order_qty, 1);
      v_par       := ROUND(v_par, 1);

      DECLARE
        v_min numeric := ROUND(v_ss, 1);
        v_rop numeric := ROUND((r.d_total * v_lt) + v_ss, 1);
      BEGIN
        -- c. Upsert central stats
        INSERT INTO public.uinv_central_store_stats (
          property_id, item_id, lookback_days,
          d_total, demand_variance, dept_count,
          vendor_lead_time_days, lead_time_stddev_days,
          safety_stock_method, ss_central,
          central_min, central_rop, central_order_qty, central_par,
          combined_dept_par, combined_dept_rop,
          service_level, z_score, dept_breakdown, calculated_at
        ) VALUES (
          r.property_id, r.item_id, p_lookback_days,
          r.d_total, v_demand_variance, r.dept_count,
          v_lt, v_lt_stddev,
          v_method, v_ss,
          v_min, v_rop, v_order_qty, v_par,
          v_combined_dept_par, v_combined_dept_rop,
          v_service, v_z, COALESCE(r.dept_breakdown, '[]'::jsonb), now()
        )
        ON CONFLICT (item_id, lookback_days)
        DO UPDATE SET
          d_total = EXCLUDED.d_total,
          demand_variance = EXCLUDED.demand_variance,
          dept_count = EXCLUDED.dept_count,
          vendor_lead_time_days = EXCLUDED.vendor_lead_time_days,
          lead_time_stddev_days = EXCLUDED.lead_time_stddev_days,
          safety_stock_method = EXCLUDED.safety_stock_method,
          ss_central = EXCLUDED.ss_central,
          central_min = EXCLUDED.central_min,
          central_rop = EXCLUDED.central_rop,
          central_order_qty = EXCLUDED.central_order_qty,
          central_par = EXCLUDED.central_par,
          combined_dept_par = EXCLUDED.combined_dept_par,
          combined_dept_rop = EXCLUDED.combined_dept_rop,
          service_level = EXCLUDED.service_level,
          z_score = EXCLUDED.z_score,
          dept_breakdown = EXCLUDED.dept_breakdown,
          calculated_at = now();

        -- d. Update Main Warehouse stock balance thresholds
        UPDATE public.uinv_stock_balances
          SET replenish_min = v_rop,
              replenish_max = v_par,
              updated_at = now()
          WHERE item_id = r.item_id
            AND store_id = 'UINV-ST-MAIN'
            AND (p_property_id IS NULL OR property_id = p_property_id);

        -- e. Update item master so procurement auto-trigger sees central values
        UPDATE public.uinv_items
          SET reorder_point = v_rop,
              par_level = v_par,
              min_stock = v_min,
              updated_at = now()
          WHERE id = r.item_id;

        -- Return row
        item_id := r.item_id;
        d_total := r.d_total;
        central_min := v_min;
        central_rop := v_rop;
        central_par := v_par;
        ss_method := v_method;
        dept_count := r.dept_count;
        RETURN NEXT;
      END;
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_central_store_stats(int, uuid) TO authenticated;

COMMENT ON FUNCTION public.refresh_central_store_stats IS
  'Calculates Central Store dynamic Min/ROP/Par from aggregated department demand. ROP = D_Total × LT_Vendor + SS_Central. SS method configurable (bulletproof/statistical). Updates uinv_stock_balances (MAIN) + uinv_items.';

-- ════════════════════════════════════════════════════════════════
-- 4. Schedule daily recalculation via pg_cron (if available)
-- ════════════════════════════════════════════════════════════════
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Only unschedule if the job already exists (avoid error on first run)
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'uinv-central-par-recalc') THEN
      PERFORM cron.unschedule('uinv-central-par-recalc');
    END IF;
    PERFORM cron.schedule(
      'uinv-central-par-recalc',
      '30 1 * * *',
      $job$SELECT * FROM public.refresh_central_store_stats(30, NULL);$job$
    );
    RAISE NOTICE 'pg_cron: scheduled central par recalculation daily at 1:30 AM.';
  ELSE
    RAISE NOTICE 'pg_cron not installed — central par must be triggered via API.';
  END IF;
END $cron$;

-- ════════════════════════════════════════════════════════════════
-- 5. Verification
-- ════════════════════════════════════════════════════════════════
DO $verify$
BEGIN
  RAISE NOTICE 'Migration 376 complete: Central Store dynamic par system installed.';
  RAISE NOTICE 'Table: uinv_central_store_stats';
  RAISE NOTICE 'Function: refresh_central_store_stats(lookback_days, property_id)';
  RAISE NOTICE 'Config columns added to uinv_dynamic_par_config: safety_stock_method, lead_time_stddev_days';
END $verify$;
