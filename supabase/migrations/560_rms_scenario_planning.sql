-- RMS Scenario Planning module.
-- Replaces hardcoded mock scenarios in ScenarioPlanning.tsx.

CREATE TABLE IF NOT EXISTS rms_scenarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  scenario_type TEXT NOT NULL DEFAULT 'pricing', -- 'baseline','pricing','demand','competitive','mixed'
  description   TEXT,
  parameters    JSONB NOT NULL DEFAULT '{}'::jsonb,
  results       JSONB NOT NULL DEFAULT '{}'::jsonb, -- occupancy/adr/revpar/revenue/profit
  status        TEXT NOT NULL DEFAULT 'draft', -- 'active','draft'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_scenario_type ON rms_scenarios(scenario_type);
CREATE INDEX IF NOT EXISTS idx_rms_scenario_status ON rms_scenarios(status);

CREATE OR REPLACE FUNCTION public.trg_rms_scenarios_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_scenario_updated ON rms_scenarios;
CREATE TRIGGER trg_rms_scenario_updated BEFORE UPDATE ON rms_scenarios FOR EACH ROW EXECUTE FUNCTION public.trg_rms_scenarios_set_updated_at();

ALTER TABLE rms_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_scenario_read ON rms_scenarios;
CREATE POLICY rms_scenario_read ON rms_scenarios FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_scenario_write ON rms_scenarios;
CREATE POLICY rms_scenario_write ON rms_scenarios FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_scenarios (name, scenario_type, description, parameters, results, status, created_at) VALUES
  ('Baseline - Current Strategy', 'baseline', 'Current pricing and inventory strategy', '{"occupancy":78,"adr":145,"revpar":113,"revenue":45000}'::jsonb, '{"occupancy":78,"adr":145,"revpar":113,"revenue":45000,"profit":12600}'::jsonb, 'active', '2024-01-15'),
  ('Aggressive Pricing', 'pricing', 'Increase rates by 15% across all room types', '{"rateIncrease":15,"targetOccupancy":72}'::jsonb, '{"occupancy":72,"adr":167,"revpar":120,"revenue":48000,"profit":14400}'::jsonb, 'draft', '2024-01-20'),
  ('Volume Focus', 'demand', 'Reduce rates by 10% to drive occupancy to 85%', '{"rateDecrease":10,"targetOccupancy":85}'::jsonb, '{"occupancy":85,"adr":131,"revpar":111,"revenue":44250,"profit":13275}'::jsonb, 'draft', '2024-01-22'),
  ('Competitive Parity', 'competitive', 'Match competitor rates within 5%', '{"competitorMatch":95,"rateAdjustment":8}'::jsonb, '{"occupancy":80,"adr":157,"revpar":126,"revenue":50400,"profit":15120}'::jsonb, 'draft', '2024-01-25'),
  ('Mixed Strategy', 'mixed', 'Premium rates for peak, discount for off-peak', '{"peakIncrease":20,"offPeakDecrease":15}'::jsonb, '{"occupancy":76,"adr":152,"revpar":115,"revenue":45750,"profit":13725}'::jsonb, 'draft', '2024-01-28')
ON CONFLICT DO NOTHING;
