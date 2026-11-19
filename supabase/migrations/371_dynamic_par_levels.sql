-- ════════════════════════════════════════════════════════════════
-- Migration 371: Dynamic Par Levels from Historical Consumption
-- ════════════════════════════════════════════════════════════════
--
-- Replaces static min/max/reorder_point values with dynamic par levels
-- calculated from actual consumption history in uinv_stock_ledger.
--
-- Components:
--   1. uinv_consumption_stats table — cached daily/weekly/monthly
--      consumption statistics per item+store.
--   2. uinv_dynamic_par_config table — per-store or per-item
--      configuration for the dynamic par calculation (lead time,
--      safety stock days, reorder cycle, lookback window).
--   3. calculate_dynamic_par_levels() function — analyzes historical
--      consumption and updates replenish_min/replenish_max on
--      uinv_stock_balances.
--   4. refresh_consumption_stats() function — aggregates ledger data
--      into the consumption stats cache table.
--   5. pg_cron schedule for periodic recalculation.
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 1. uinv_consumption_stats — cached consumption statistics
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_consumption_stats (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text NOT NULL REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  -- Lookback period in days (e.g. 30, 60, 90)
  lookback_days int NOT NULL DEFAULT 30,
  -- Total quantity consumed in the lookback period
  total_consumed numeric(12,3) NOT NULL DEFAULT 0,
  -- Average daily consumption
  avg_daily_consumption numeric(12,3) NOT NULL DEFAULT 0,
  -- Average weekly consumption
  avg_weekly_consumption numeric(12,3) NOT NULL DEFAULT 0,
  -- Days with consumption activity in the period
  active_days int NOT NULL DEFAULT 0,
  -- Peak daily consumption observed
  peak_daily_consumption numeric(12,3) NOT NULL DEFAULT 0,
  -- Standard deviation of daily consumption (volatility indicator)
  consumption_stddev numeric(12,3) NOT NULL DEFAULT 0,
  -- Calculated dynamic par values
  dynamic_par_level numeric(12,3) NOT NULL DEFAULT 0,
  dynamic_replenish_min numeric(12,3) NOT NULL DEFAULT 0,
  dynamic_replenish_max numeric(12,3) NOT NULL DEFAULT 0,
  -- Service level target (e.g. 0.95 = 95% chance of not stocking out)
  service_level numeric(5,2) NOT NULL DEFAULT 0.95,
  -- Calculated at
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, store_id, lookback_days)
);

CREATE INDEX IF NOT EXISTS idx_uinv_consumption_stats_store
  ON public.uinv_consumption_stats(store_id);
CREATE INDEX IF NOT EXISTS idx_uinv_consumption_stats_item
  ON public.uinv_consumption_stats(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_consumption_stats_lookback
  ON public.uinv_consumption_stats(lookback_days);

ALTER TABLE public.uinv_consumption_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read uinv_consumption_stats"
  ON public.uinv_consumption_stats FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "authenticated can manage uinv_consumption_stats"
  ON public.uinv_consumption_stats FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_consumption_stats"
  ON public.uinv_consumption_stats FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_consumption_stats TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_dynamic_par_config — per-store / per-item configuration
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_dynamic_par_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  item_id text REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  -- NULL store_id + item_id = global default
  -- store_id set, item_id NULL = store default
  -- both set = item-specific in store
  -- Lookback window in days for historical analysis
  lookback_days int NOT NULL DEFAULT 30,
  -- Lead time in days (time from order to delivery from Central)
  lead_time_days int NOT NULL DEFAULT 2,
  -- Safety stock in days (buffer for demand variability)
  safety_stock_days int NOT NULL DEFAULT 3,
  -- Reorder cycle in days (how often we reorder, e.g. weekly = 7)
  reorder_cycle_days int NOT NULL DEFAULT 7,
  -- Service level target (0.90 - 0.99)
  service_level numeric(5,2) NOT NULL DEFAULT 0.95,
  -- Whether dynamic par is enabled for this scope
  is_enabled boolean NOT NULL DEFAULT true,
  -- Minimum threshold below which we won't set replenish_min
  -- (prevents tiny par levels for slow-moving items)
  min_replenish_threshold numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One config per scope
  UNIQUE (store_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_uinv_dyn_par_config_store
  ON public.uinv_dynamic_par_config(store_id);

ALTER TABLE public.uinv_dynamic_par_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_dynamic_par_config"
  ON public.uinv_dynamic_par_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_dynamic_par_config"
  ON public.uinv_dynamic_par_config FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_dynamic_par_config TO authenticated;

-- Seed a global default config
INSERT INTO public.uinv_dynamic_par_config (store_id, item_id, lookback_days, lead_time_days, safety_stock_days, reorder_cycle_days, service_level, is_enabled)
VALUES (NULL, NULL, 30, 2, 3, 7, 0.95, true)
ON CONFLICT (store_id, item_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. refresh_consumption_stats() — aggregate ledger into stats cache
-- ════════════════════════════════════════════════════════════════
-- Calculates per-item-per-store consumption statistics from the stock
-- ledger for a given lookback period. Results are upserted into
-- uinv_consumption_stats.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refresh_consumption_stats(
  p_lookback_days int DEFAULT 30,
  p_property_id uuid DEFAULT NULL
)
RETURNS TABLE (
  item_id text,
  store_id text,
  avg_daily numeric,
  dynamic_par numeric,
  dynamic_min numeric,
  dynamic_max numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cutoff timestamptz;
  v_lead_time int;
  v_safety_days int;
  v_reorder_cycle int;
  v_service_level numeric;
  v_min_threshold numeric;
  v_z_score numeric;
  v_par_level numeric;
  v_repl_min numeric;
  v_repl_max numeric;
  r RECORD;
BEGIN
  v_cutoff := now() - (p_lookback_days || ' days')::interval;

  -- Get global config defaults
  SELECT
    COALESCE(lead_time_days, 2),
    COALESCE(safety_stock_days, 3),
    COALESCE(reorder_cycle_days, 7),
    COALESCE(service_level, 0.95),
    COALESCE(min_replenish_threshold, 0)
  INTO v_lead_time, v_safety_days, v_reorder_cycle, v_service_level, v_min_threshold
  FROM public.uinv_dynamic_par_config
  WHERE store_id IS NULL AND item_id IS NULL
  LIMIT 1;

  -- Z-score for service level (approximation)
  -- 0.90 → 1.28, 0.95 → 1.65, 0.99 → 2.33
  v_z_score := CASE
    WHEN v_service_level >= 0.99 THEN 2.33
    WHEN v_service_level >= 0.95 THEN 1.65
    WHEN v_service_level >= 0.90 THEN 1.28
    ELSE 1.65
  END;

  -- Clear old stats for this lookback period
  DELETE FROM public.uinv_consumption_stats
  WHERE lookback_days = p_lookback_days
    AND (p_property_id IS NULL OR property_id = p_property_id);

  -- Aggregate consumption from ledger
  FOR r IN
    SELECT
      sl.item_id,
      sl.store_id,
      sl.property_id,
      COALESCE(SUM(sl.quantity_out), 0) AS total_consumed,
      COALESCE(AVG(sl.quantity_out), 0) AS avg_per_tx,
      COUNT(DISTINCT DATE(sl.transaction_date)) AS active_days,
      MAX(sl.quantity_out) AS peak_daily,
      COALESCE(STDDEV(sl.quantity_out), 0) AS stddev_consumption
    FROM public.uinv_stock_ledger sl
    WHERE sl.transaction_type IN ('Consumption', 'Issue', 'Waste')
      AND sl.quantity_out > 0
      AND sl.transaction_date >= v_cutoff
      AND (p_property_id IS NULL OR sl.property_id = p_property_id)
    GROUP BY sl.item_id, sl.store_id, sl.property_id
  LOOP
    -- Average daily consumption across the full lookback period
    -- (not just active days — we want true daily average including zero days)
    DECLARE
      v_avg_daily numeric;
      v_avg_weekly numeric;
    BEGIN
      v_avg_daily := r.total_consumed / p_lookback_days;
      v_avg_weekly := v_avg_daily * 7;

      -- Check for store/item-specific config overrides
      SELECT
        COALESCE(c.lead_time_days, v_lead_time),
        COALESCE(c.safety_stock_days, v_safety_days),
        COALESCE(c.reorder_cycle_days, v_reorder_cycle),
        COALESCE(c.service_level, v_service_level),
        COALESCE(c.min_replenish_threshold, v_min_threshold)
      INTO v_lead_time, v_safety_days, v_reorder_cycle, v_service_level, v_min_threshold
      FROM public.uinv_dynamic_par_config c
      WHERE c.store_id = r.store_id AND c.item_id = r.item_id AND c.is_enabled = true
      LIMIT 1;

      -- If no item-specific config, try store-level
      IF NOT FOUND THEN
        SELECT
          COALESCE(c.lead_time_days, v_lead_time),
          COALESCE(c.safety_stock_days, v_safety_days),
          COALESCE(c.reorder_cycle_days, v_reorder_cycle),
          COALESCE(c.service_level, v_service_level),
          COALESCE(c.min_replenish_threshold, v_min_threshold)
        INTO v_lead_time, v_safety_days, v_reorder_cycle, v_service_level, v_min_threshold
        FROM public.uinv_dynamic_par_config c
        WHERE c.store_id = r.store_id AND c.item_id IS NULL AND c.is_enabled = true
        LIMIT 1;
      END IF;

      -- Dynamic par level = avg_daily × (lead_time + safety_stock + reorder_cycle)
      -- This is the target stock level right after replenishment
      v_par_level := v_avg_daily * (v_lead_time + v_safety_days + v_reorder_cycle);

      -- Dynamic replenish_min = avg_daily × (lead_time + safety_stock)
      -- This is the reorder trigger — when stock drops to this, reorder
      v_repl_min := v_avg_daily * (v_lead_time + v_safety_days);

      -- Add safety stock based on demand variability (z-score × stddev × sqrt(lead_time))
      v_repl_min := v_repl_min + (v_z_score * COALESCE(r.stddev_consumption, 0) * SQRT(v_lead_time));

      -- Dynamic replenish_max = par_level (fill up to par on replenishment)
      v_repl_max := v_par_level;

      -- Apply minimum threshold for slow-moving items
      IF v_repl_min < v_min_threshold THEN
        v_repl_min := v_min_threshold;
      END IF;
      IF v_repl_max < v_min_threshold THEN
        v_repl_max := v_min_threshold;
      END IF;

      -- Round to reasonable precision
      v_par_level := ROUND(v_par_level, 1);
      v_repl_min := ROUND(v_repl_min, 1);
      v_repl_max := ROUND(v_repl_max, 1);

      -- Upsert consumption stats
      INSERT INTO public.uinv_consumption_stats (
        property_id, item_id, store_id, lookback_days,
        total_consumed, avg_daily_consumption, avg_weekly_consumption,
        active_days, peak_daily_consumption, consumption_stddev,
        dynamic_par_level, dynamic_replenish_min, dynamic_replenish_max,
        service_level, calculated_at
      ) VALUES (
        r.property_id, r.item_id, r.store_id, p_lookback_days,
        r.total_consumed, v_avg_daily, v_avg_weekly,
        r.active_days, r.peak_daily, COALESCE(r.stddev_consumption, 0),
        v_par_level, v_repl_min, v_repl_max,
        v_service_level, now()
      )
      ON CONFLICT (item_id, store_id, lookback_days)
      DO UPDATE SET
        total_consumed = EXCLUDED.total_consumed,
        avg_daily_consumption = EXCLUDED.avg_daily_consumption,
        avg_weekly_consumption = EXCLUDED.avg_weekly_consumption,
        active_days = EXCLUDED.active_days,
        peak_daily_consumption = EXCLUDED.peak_daily_consumption,
        consumption_stddev = EXCLUDED.consumption_stddev,
        dynamic_par_level = EXCLUDED.dynamic_par_level,
        dynamic_replenish_min = EXCLUDED.dynamic_replenish_min,
        dynamic_replenish_max = EXCLUDED.dynamic_replenish_max,
        service_level = EXCLUDED.service_level,
        calculated_at = now();

      -- Update the stock balance with dynamic par values
      UPDATE public.uinv_stock_balances
      SET replenish_min = v_repl_min,
          replenish_max = v_repl_max,
          updated_at = now()
      WHERE item_id = r.item_id
        AND store_id = r.store_id
        AND (p_property_id IS NULL OR property_id = p_property_id);

      -- Also update the item's par_level and reorder_point
      UPDATE public.uinv_items
      SET par_level = v_par_level,
          reorder_point = v_repl_min,
          updated_at = now()
      WHERE id = r.item_id;

      -- Return the calculated values
      item_id := r.item_id;
      store_id := r.store_id;
      avg_daily := v_avg_daily;
      dynamic_par := v_par_level;
      dynamic_min := v_repl_min;
      dynamic_max := v_repl_max;
      RETURN NEXT;
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_consumption_stats(int, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. calculate_dynamic_par_levels() — convenience wrapper
-- ════════════════════════════════════════════════════════════════
-- Refreshes consumption stats AND applies dynamic par levels to stock
-- balances. This is the main entry point for the dynamic par system.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.calculate_dynamic_par_levels(
  p_lookback_days int DEFAULT 30,
  p_property_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_items int,
  items_updated int,
  avg_daily_consumption numeric,
  new_par_level numeric,
  new_replenish_min numeric,
  new_replenish_max numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delegate to refresh_consumption_stats which does the heavy lifting
  PERFORM * FROM public.refresh_consumption_stats(p_lookback_days, p_property_id);

  -- Return summary
  total_items := 0;
  items_updated := 0;
  avg_daily_consumption := 0;
  new_par_level := 0;
  new_replenish_min := 0;
  new_replenish_max := 0;

  RETURN NEXT;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_dynamic_par_levels(int, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. Schedule periodic recalculation via pg_cron (if available)
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Recalculate dynamic par levels daily at 1 AM
    PERFORM cron.schedule(
      'uinv-dynamic-par-recalc',
      '0 1 * * *',
      $$SELECT * FROM public.refresh_consumption_stats(30, NULL);$$
    );
    RAISE NOTICE 'pg_cron: scheduled dynamic par recalculation daily at 1 AM.';
  ELSE
    RAISE NOTICE 'pg_cron not installed — dynamic par must be triggered via API.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 6. Verification
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'Migration 371 complete: dynamic par level system installed.';
  RAISE NOTICE 'Tables: uinv_consumption_stats, uinv_dynamic_par_config';
  RAISE NOTICE 'Functions: refresh_consumption_stats(), calculate_dynamic_par_levels()';
END $$;
