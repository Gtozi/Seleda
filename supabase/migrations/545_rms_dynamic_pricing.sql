-- RMS Dynamic Pricing module.
-- Replaces hardcoded mock strategies/rules/adjustments in DynamicPricing.tsx.

CREATE TABLE IF NOT EXISTS rms_dynamic_pricing_strategies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  auto_update     BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_dynamic_pricing_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  strategy_code   TEXT NOT NULL REFERENCES rms_dynamic_pricing_strategies(code) ON DELETE CASCADE,
  condition_type  TEXT NOT NULL DEFAULT 'occupancy',
  threshold_value NUMERIC(12,2),
  threshold_label TEXT,
  adjustment      NUMERIC(6,2) NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_dynamic_pricing_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  old_rate        NUMERIC(12,2) NOT NULL,
  new_rate        NUMERIC(12,2) NOT NULL,
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_dp_strat_property ON rms_dynamic_pricing_strategies(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_dp_rule_property   ON rms_dynamic_pricing_rules(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_dp_adj_property    ON rms_dynamic_pricing_adjustments(property_id);

CREATE OR REPLACE FUNCTION public.trg_rms_dp_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_strat_updated ON rms_dynamic_pricing_strategies;
CREATE TRIGGER trg_rms_strat_updated
  BEFORE UPDATE ON rms_dynamic_pricing_strategies
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dp_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_rule_updated ON rms_dynamic_pricing_rules;
CREATE TRIGGER trg_rms_rule_updated
  BEFORE UPDATE ON rms_dynamic_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dp_set_updated_at();

ALTER TABLE rms_dynamic_pricing_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_dynamic_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_dynamic_pricing_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_dp_strat_read ON rms_dynamic_pricing_strategies;
CREATE POLICY rms_dp_strat_read ON rms_dynamic_pricing_strategies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_dp_strat_write ON rms_dynamic_pricing_strategies;
CREATE POLICY rms_dp_strat_write ON rms_dynamic_pricing_strategies FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_dp_rule_read ON rms_dynamic_pricing_rules;
CREATE POLICY rms_dp_rule_read ON rms_dynamic_pricing_rules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_dp_rule_write ON rms_dynamic_pricing_rules;
CREATE POLICY rms_dp_rule_write ON rms_dynamic_pricing_rules FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_dp_adj_read ON rms_dynamic_pricing_adjustments;
CREATE POLICY rms_dp_adj_read ON rms_dynamic_pricing_adjustments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_dp_adj_write ON rms_dynamic_pricing_adjustments;
CREATE POLICY rms_dp_adj_write ON rms_dynamic_pricing_adjustments FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_dynamic_pricing_strategies (code,name,description,active,auto_update) VALUES
  ('bar','BAR (Best Available Rate)','Standard rate with dynamic adjustments',true,true),
  ('occupancy','Occupancy-based Pricing','Rates adjust based on occupancy levels',true,true),
  ('demand','Demand-based Pricing','AI-driven demand forecasting',true,true),
  ('competitor','Competitor-based Pricing','Market-competitive rate positioning',false,true),
  ('event','Event Pricing','Dynamic rates during high-demand events',true,true),
  ('los','Length of Stay Pricing','Discounts for longer stays',true,true),
  ('last_minute','Last-minute Pricing','Discounts for unsold inventory',false,true),
  ('early_booking','Early Booking Pricing','Discounts for advance bookings',true,true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO rms_dynamic_pricing_rules (room_type,strategy_code,condition_type,threshold_value,threshold_label,adjustment,active) VALUES
  ('Deluxe Suite','occupancy','occupancy',80,'Min occupancy',15,true),
  ('Standard Room','demand','demand',75,'Demand score',10,true),
  ('Ocean View','event','event',NULL,'Conference',25,true),
  ('Family Suite','los','los',5,'Min nights',-10,true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_dynamic_pricing_adjustments (room_type,old_rate,new_rate,reason) VALUES
  ('Deluxe Suite',150,165,'High occupancy forecast'),
  ('Standard Room',100,105,'Competitor rate increase'),
  ('Ocean View',200,190,'Low demand forecast')
ON CONFLICT DO NOTHING;
