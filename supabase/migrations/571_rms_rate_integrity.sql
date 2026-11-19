-- ============================================================================
-- Migration: 571_rms_rate_integrity.sql
-- ----------------------------------------------------------------------------
-- Closes the RMS → PMS rate-flow gap:
--
-- 1. rms_daily_rate_overrides — a date-scoped selling-rate override written by
--    "apply" on pricing recommendations, so a recommendation for one date does
--    not silently rewrite the base rate forever.
-- 2. Remaps seed recommendations that point at nonexistent room types
--    (rt-1..rt-4 / 'Deluxe Suite' etc.) onto real room_types rows.
-- 3. Adds the missing FK rms_pricing_recommendations.room_type_id → room_types.id
--    (channel_room_mapping / channel_inventory_snapshot / rate_parity_monitor
--    already have theirs from migration 126).
-- 4. get_effective_nightly_rate() now resolves the room type by id OR name,
--    prefers room_types.base_price (parity with front desk + public booking)
--    and honors daily overrides for the stay date.
-- ============================================================================

-- ── 1. Daily rate overrides ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rms_daily_rate_overrides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id uuid REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id text NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  rate_date date NOT NULL,
  rate numeric NOT NULL CHECK (rate >= 0),
  source text NOT NULL DEFAULT 'rms',
  recommendation_id uuid REFERENCES rms_pricing_recommendations(id) ON DELETE SET NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rms_daily_rate_overrides_scope
  ON rms_daily_rate_overrides (COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid), room_type_id, rate_date);
CREATE INDEX IF NOT EXISTS idx_rms_daily_rate_overrides_date ON rms_daily_rate_overrides (rate_date);
CREATE INDEX IF NOT EXISTS idx_rms_daily_rate_overrides_type ON rms_daily_rate_overrides (room_type_id);

ALTER TABLE rms_daily_rate_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rms_daily_rate_overrides' AND policyname = 'rms_daily_rate_overrides_service') THEN
    CREATE POLICY rms_daily_rate_overrides_service ON rms_daily_rate_overrides
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rms_daily_rate_overrides' AND policyname = 'rms_daily_rate_overrides_read') THEN
    CREATE POLICY rms_daily_rate_overrides_read ON rms_daily_rate_overrides
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ── 2. Remap seed recommendations to real room types ────────────────────────
-- Name-driven mapping so it works on any environment with the demo room types.
WITH map(fake_name, real_name) AS (
  VALUES
    ('Deluxe Suite',  'Suite'),
    ('Standard Room', 'Single Room'),
    ('Ocean View',    'Double Room'),
    ('Family Suite',  'Twin')
)
UPDATE rms_pricing_recommendations r
SET room_type_id = rt.id,
    room_type    = rt.name,
    updated_at   = now()
FROM map m
JOIN room_types rt ON rt.name = m.real_name
WHERE r.room_type = m.fake_name
  AND NOT EXISTS (SELECT 1 FROM room_types t WHERE t.id = r.room_type_id);

-- Remove any remaining orphan recommendations: seed rows pointing at room
-- types that do not exist can never be applied and would block the FK below.
DELETE FROM rms_pricing_recommendations r
WHERE NOT EXISTS (SELECT 1 FROM room_types t WHERE t.id = r.room_type_id);

-- ── 3. FK: recommendations.room_type_id → room_types.id (audit item 3.3) ────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rms_pricing_recommendations_room_type_id_fkey') THEN
    ALTER TABLE rms_pricing_recommendations
      ADD CONSTRAINT rms_pricing_recommendations_room_type_id_fkey
      FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. get_effective_nightly_rate: overrides + base_price parity ────────────
CREATE OR REPLACE FUNCTION public.get_effective_nightly_rate(
  p_room_type text,
  p_check_in_date date,
  p_rate_plan_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_room_type_id text;
  v_property_id uuid;
  v_base_rate numeric;
  v_override numeric;
  v_season_multiplier numeric := 1.0;
  v_rate_plan_modifier numeric := 1.0;
  v_effective_rate numeric;
  v_season_name text := '';
  v_rate_plan_name text := 'Standard Rate';
begin
  -- Resolve the room type by id or by name; base_price is the authoritative
  -- selling rate used by the front desk and public booking (fixes the drift
  -- where this function read rooms.rate while UIs read room_types.base_price).
  select id, property_id, base_price
    into v_room_type_id, v_property_id, v_base_rate
  from room_types
  where id = p_room_type or name = p_room_type
  order by (id = p_room_type) desc
  limit 1;

  -- Daily RMS rate override wins over the base price for that stay date.
  if v_room_type_id is not null then
    select o.rate into v_override
    from rms_daily_rate_overrides o
    where o.room_type_id = v_room_type_id
      and o.rate_date = p_check_in_date
      and (o.property_id is null or o.property_id = v_property_id)
    order by (o.property_id = v_property_id) desc nulls last
    limit 1;
    if v_override is not null then
      v_base_rate := v_override;
    end if;
  end if;

  -- Legacy fallback: first room's rack rate of this type.
  if v_base_rate is null then
    select coalesce(rate, 0) into v_base_rate
    from rooms
    where type = p_room_type
    limit 1;
  end if;
  v_base_rate := coalesce(v_base_rate, 0);

  -- Seasonal multiplier
  select
    coalesce(multiplier, 1.0),
    name
    into v_season_multiplier, v_season_name
  from seasons
  where
    (to_char(p_check_in_date, 'MM')::int = start_month and to_char(p_check_in_date, 'DD')::int >= start_day)
    or
    (to_char(p_check_in_date, 'MM')::int = end_month and to_char(p_check_in_date, 'DD')::int <= end_day)
    or
    (start_month > end_month and (
      (to_char(p_check_in_date, 'MM')::int = start_month and to_char(p_check_in_date, 'DD')::int >= start_day) or
      (to_char(p_check_in_date, 'MM')::int = end_month and to_char(p_check_in_date, 'DD')::int <= end_day)
    ))
  limit 1;

  -- Rate plan modifier
  if p_rate_plan_id is not null then
    select
      coalesce(base_modifier, 1.0),
      name
      into v_rate_plan_modifier, v_rate_plan_name
    from rate_plans
    where id = p_rate_plan_id
    and active = true
    limit 1;
  end if;

  v_effective_rate := round(v_base_rate * v_season_multiplier * v_rate_plan_modifier, 2);

  return jsonb_build_object(
    'roomType', p_room_type,
    'roomTypeId', v_room_type_id,
    'baseRate', v_base_rate,
    'overrideApplied', v_override is not null,
    'seasonMultiplier', v_season_multiplier,
    'seasonName', v_season_name,
    'ratePlanModifier', v_rate_plan_modifier,
    'ratePlanName', v_rate_plan_name,
    'effectiveRate', v_effective_rate
  );
end;
$function$;
