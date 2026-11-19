-- RMS Yield Management module.
-- Replaces hardcoded mock optimization types, metrics, opportunities, and scenarios in YieldManagement.tsx.

CREATE TABLE IF NOT EXISTS rms_yield_optimization_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  icon_name       TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_yield_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  metric_name     TEXT NOT NULL,
  current_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_value    NUMERIC(12,2) NOT NULL DEFAULT 0,
  trend           TEXT NOT NULL DEFAULT 'up',
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_yield_opportunities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  opportunity_type  TEXT NOT NULL,
  room_type         TEXT NOT NULL,
  suggestion        TEXT NOT NULL,
  potential_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  confidence        INTEGER NOT NULL DEFAULT 0,
  applied           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_yield_scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  occupancy       NUMERIC(6,2) NOT NULL DEFAULT 0,
  adr             NUMERIC(12,2) NOT NULL DEFAULT 0,
  revpar          NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue         NUMERIC(14,2) NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_yield_opt_code ON rms_yield_optimization_types(code);
CREATE INDEX IF NOT EXISTS idx_rms_yield_metric_name ON rms_yield_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_rms_yield_opp_applied ON rms_yield_opportunities(applied);
CREATE INDEX IF NOT EXISTS idx_rms_yield_scenario_name ON rms_yield_scenarios(name);

CREATE OR REPLACE FUNCTION public.trg_rms_yield_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_yield_opt_updated ON rms_yield_optimization_types;
CREATE TRIGGER trg_rms_yield_opt_updated
  BEFORE UPDATE ON rms_yield_optimization_types
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_yield_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_yield_metric_updated ON rms_yield_metrics;
CREATE TRIGGER trg_rms_yield_metric_updated
  BEFORE UPDATE ON rms_yield_metrics
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_yield_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_yield_opp_updated ON rms_yield_opportunities;
CREATE TRIGGER trg_rms_yield_opp_updated
  BEFORE UPDATE ON rms_yield_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_yield_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_yield_scenario_updated ON rms_yield_scenarios;
CREATE TRIGGER trg_rms_yield_scenario_updated
  BEFORE UPDATE ON rms_yield_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_yield_set_updated_at();

ALTER TABLE rms_yield_optimization_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_yield_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_yield_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_yield_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_yield_opt_read ON rms_yield_optimization_types;
CREATE POLICY rms_yield_opt_read ON rms_yield_optimization_types FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_yield_opt_write ON rms_yield_optimization_types;
CREATE POLICY rms_yield_opt_write ON rms_yield_optimization_types FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_yield_metric_read ON rms_yield_metrics;
CREATE POLICY rms_yield_metric_read ON rms_yield_metrics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_yield_metric_write ON rms_yield_metrics;
CREATE POLICY rms_yield_metric_write ON rms_yield_metrics FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_yield_opp_read ON rms_yield_opportunities;
CREATE POLICY rms_yield_opp_read ON rms_yield_opportunities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_yield_opp_write ON rms_yield_opportunities;
CREATE POLICY rms_yield_opp_write ON rms_yield_opportunities FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_yield_scenario_read ON rms_yield_scenarios;
CREATE POLICY rms_yield_scenario_read ON rms_yield_scenarios FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_yield_scenario_write ON rms_yield_scenarios;
CREATE POLICY rms_yield_scenario_write ON rms_yield_scenarios FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_yield_optimization_types (code, name, description, icon_name, active) VALUES
  ('occupancy', 'Occupancy Optimization', 'Maximize room occupancy', 'Bed', true),
  ('adr', 'ADR Optimization', 'Maximize average daily rate', 'DollarSign', true),
  ('revenue', 'Revenue Optimization', 'Maximize total revenue', 'TrendingUp', true),
  ('mix', 'Mix Optimization', 'Optimize guest segment mix', 'BarChart3', true),
  ('los', 'Length of Stay', 'Optimize stay duration', 'Calendar', true),
  ('upgrade', 'Upgrade Opportunities', 'Identify upgrade potential', 'Zap', true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon_name = EXCLUDED.icon_name, active = EXCLUDED.active;

INSERT INTO rms_yield_metrics (metric_name, current_value, target_value, trend, display_order) VALUES
  ('Occupancy Rate', 78, 85, 'up', 1),
  ('ADR', 145, 160, 'up', 2),
  ('RevPAR', 113, 136, 'up', 3),
  ('Revenue per Guest', 280, 320, 'up', 4)
ON CONFLICT DO NOTHING;

INSERT INTO rms_yield_opportunities (opportunity_type, room_type, suggestion, potential_revenue, confidence, applied) VALUES
  ('Upgrade', 'Standard Room', 'Upgrade to Deluxe Suite', 45, 85, false),
  ('LOS Extension', 'Deluxe Suite', 'Extend stay from 3 to 5 nights', 120, 72, false),
  ('Cross-sell', 'Ocean View', 'Add dining package', 35, 68, false),
  ('Mix Adjustment', 'Family Suite', 'Target corporate segment', 80, 75, false)
ON CONFLICT DO NOTHING;

INSERT INTO rms_yield_scenarios (name, occupancy, adr, revpar, revenue, active) VALUES
  ('Current', 78, 145, 113, 45000, true),
  ('Optimistic', 85, 160, 136, 58000, true),
  ('Conservative', 75, 140, 105, 42000, true)
ON CONFLICT DO NOTHING;
