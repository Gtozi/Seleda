-- Migration: RMS Demand Forecasts
-- Real persistence for the Revenue Management → Demand Forecasts module.
--
-- Stores daily demand predictions (occupancy / ADR / RevPAR / confidence),
-- the qualitative demand factors driving the forecast, and rolling
-- forecast-accuracy snapshots. Replaces the hardcoded mock arrays in
-- DemandForecasts.tsx; the /api/rms-portal/forecasts endpoint reads these
-- tables directly via the service role (same pattern as /api/hk-portal/*).

-- ============================================================================
-- rms_demand_forecasts
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_demand_forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  forecast_date   DATE NOT NULL,
  room_type       TEXT NOT NULL DEFAULT 'all',
  occupancy       NUMERIC(5,2) NOT NULL DEFAULT 0
                    CHECK (occupancy BETWEEN 0 AND 100),
  adr             NUMERIC(12,2) NOT NULL DEFAULT 0,
  revpar          NUMERIC(12,2) NOT NULL DEFAULT 0,
  demand          TEXT NOT NULL DEFAULT 'medium'
                    CHECK (demand IN ('high','medium','low')),
  confidence      SMALLINT NOT NULL DEFAULT 0
                    CHECK (confidence BETWEEN 0 AND 100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_fc_property ON rms_demand_forecasts(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_fc_date   ON rms_demand_forecasts(forecast_date);
CREATE INDEX IF NOT EXISTS idx_rms_fc_room   ON rms_demand_forecasts(room_type);

-- ============================================================================
-- rms_demand_factors
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_demand_factors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  factor          TEXT NOT NULL,
  impact          TEXT NOT NULL DEFAULT 'neutral'
                    CHECK (impact IN ('positive','neutral','negative')),
  confidence      SMALLINT NOT NULL DEFAULT 0
                    CHECK (confidence BETWEEN 0 AND 100),
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_df_property ON rms_demand_factors(property_id);

-- ============================================================================
-- rms_forecast_accuracy
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_forecast_accuracy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  period          TEXT NOT NULL
                    CHECK (period IN ('7d','30d','90d')),
  accuracy        SMALLINT NOT NULL DEFAULT 0
                    CHECK (accuracy BETWEEN 0 AND 100),
  variance_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_fa_property ON rms_forecast_accuracy(property_id);

-- ============================================================================
-- RLS — authenticated users can read; only revenue managers can write.
-- ============================================================================
ALTER TABLE rms_demand_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_demand_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_forecast_accuracy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_fc_read ON rms_demand_forecasts;
CREATE POLICY rms_fc_read
  ON rms_demand_forecasts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_fc_write ON rms_demand_forecasts;
CREATE POLICY rms_fc_write
  ON rms_demand_forecasts FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_df_read ON rms_demand_factors;
CREATE POLICY rms_df_read
  ON rms_demand_factors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_df_write ON rms_demand_factors;
CREATE POLICY rms_df_write
  ON rms_demand_factors FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_fa_read ON rms_forecast_accuracy;
CREATE POLICY rms_fa_read
  ON rms_forecast_accuracy FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_fa_write ON rms_forecast_accuracy;
CREATE POLICY rms_fa_write
  ON rms_forecast_accuracy FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

-- ============================================================================
-- Seed mock data (mirrors the previous in-component mock arrays).
-- ============================================================================
INSERT INTO rms_demand_forecasts (forecast_date, room_type, occupancy, adr, revpar, demand, confidence) VALUES
  (DATE '2024-01-29', 'all', 78, 145, 113, 'high',   92),
  (DATE '2024-01-30', 'all', 82, 148, 121, 'high',   88),
  (DATE '2024-01-31', 'all', 75, 142, 107, 'medium', 85),
  (DATE '2024-02-01', 'all', 70, 138,  97, 'low',    82),
  (DATE '2024-02-02', 'all', 85, 155, 132, 'high',   90),
  (DATE '2024-02-03', 'all', 88, 160, 141, 'high',   87),
  (DATE '2024-02-04', 'all', 65, 135,  88, 'low',    80)
ON CONFLICT DO NOTHING;

INSERT INTO rms_demand_factors (factor, impact, confidence, description) VALUES
  ('Local Events',         'positive', 85, 'Conference in city center'),
  ('Seasonality',          'positive', 90, 'Peak season approaching'),
  ('Competitor Pricing',   'neutral',  75, 'Competitor rates stable'),
  ('Weather Forecast',     'negative', 70, 'Rain expected')
ON CONFLICT DO NOTHING;

INSERT INTO rms_forecast_accuracy (period, accuracy, variance_pct, snapshot_date) VALUES
  ('7d',  92, 3, DATE '2024-02-04'),
  ('30d', 88, 5, DATE '2024-02-04'),
  ('90d', 85, 7, DATE '2024-02-04')
ON CONFLICT DO NOTHING;
