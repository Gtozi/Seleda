-- RMS Business Intelligence module.
-- Replaces hardcoded mock analytics in RevenueManagement/BusinessIntelligence.tsx.

CREATE TABLE IF NOT EXISTS rms_bi_revenue_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
  occupancy     NUMERIC(5,2) NOT NULL DEFAULT 0,
  adr           NUMERIC(12,2) NOT NULL DEFAULT 0,
  revpar        NUMERIC(12,2) NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_bi_yoy_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL,
  current_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  previous_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  growth        NUMERIC(6,2) NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_bi_market_trends (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  trend         TEXT NOT NULL,
  impact        TEXT NOT NULL DEFAULT 'positive', -- 'positive','negative'
  confidence    INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_bi_forecast_accuracy (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  accuracy      NUMERIC(5,2) NOT NULL DEFAULT 0,
  variance      NUMERIC(5,2) NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_bi_heat_map (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type     TEXT NOT NULL,
  month         INTEGER NOT NULL, -- 1-12
  intensity     NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_type, month)
);

CREATE INDEX IF NOT EXISTS idx_rms_bi_period_order ON rms_bi_revenue_periods(display_order);
CREATE INDEX IF NOT EXISTS idx_rms_bi_heat_room ON rms_bi_heat_map(room_type, month);

ALTER TABLE rms_bi_revenue_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_bi_yoy_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_bi_market_trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_bi_forecast_accuracy ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_bi_heat_map ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['rms_bi_revenue_periods','rms_bi_yoy_metrics','rms_bi_market_trends','rms_bi_forecast_accuracy','rms_bi_heat_map'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rms_bi_read ON %I; CREATE POLICY rms_bi_read ON %I FOR SELECT TO authenticated USING (true);', t, t);
    EXECUTE format('DROP POLICY IF EXISTS rms_bi_write ON %I; CREATE POLICY rms_bi_write ON %I FOR ALL TO authenticated USING ((SELECT auth.jwt()) -> ''app_metadata'' ->> ''role'' IN (''revenue_manager'',''revenue'',''admin'',''system_admin'',''superuser'',''owner'',''executive'',''general_manager'',''gm'')) WITH CHECK ((SELECT auth.jwt()) -> ''app_metadata'' ->> ''role'' IN (''revenue_manager'',''revenue'',''admin'',''system_admin'',''superuser'',''owner'',''executive'',''general_manager'',''gm''));', t, t);
  END LOOP;
END $$;

INSERT INTO rms_bi_revenue_periods (period, revenue, occupancy, adr, revpar, display_order) VALUES
  ('Jan', 45000, 72, 145, 104, 1), ('Feb', 42000, 68, 142, 97, 2), ('Mar', 48000, 75, 148, 111, 3),
  ('Apr', 52000, 78, 152, 119, 4), ('May', 49000, 74, 150, 111, 5), ('Jun', 55000, 80, 155, 124, 6),
  ('Jul', 58000, 82, 158, 130, 7), ('Aug', 56000, 81, 156, 126, 8), ('Sep', 51000, 76, 152, 115, 9),
  ('Oct', 47000, 73, 148, 108, 10), ('Nov', 44000, 70, 145, 102, 11), ('Dec', 62000, 85, 165, 140, 12)
ON CONFLICT DO NOTHING;

INSERT INTO rms_bi_yoy_metrics (metric, current_value, previous_value, growth, display_order) VALUES
  ('Total Revenue', 609000, 545000, 11.7, 1),
  ('Occupancy', 76.5, 72.3, 5.8, 2),
  ('ADR', 151, 142, 6.3, 3),
  ('RevPAR', 115, 103, 11.7, 4)
ON CONFLICT DO NOTHING;

INSERT INTO rms_bi_market_trends (trend, impact, confidence, display_order) VALUES
  ('Business travel recovery', 'positive', 85, 1),
  ('Leisure demand surge', 'positive', 78, 2),
  ('Group booking increase', 'positive', 72, 3),
  ('Rate compression in OTA', 'negative', 65, 4)
ON CONFLICT DO NOTHING;

INSERT INTO rms_bi_forecast_accuracy (period, accuracy, variance, display_order) VALUES
  ('Last 7 days', 92, 3, 1),
  ('Last 30 days', 88, 5, 2),
  ('Last 90 days', 85, 7, 3)
ON CONFLICT DO NOTHING;

INSERT INTO rms_bi_heat_map (room_type, month, intensity) VALUES
  ('Deluxe Suite', 1, 82), ('Deluxe Suite', 2, 76), ('Deluxe Suite', 3, 88), ('Deluxe Suite', 4, 91), ('Deluxe Suite', 5, 85), ('Deluxe Suite', 6, 94),
  ('Standard Room', 1, 68), ('Standard Room', 2, 62), ('Standard Room', 3, 71), ('Standard Room', 4, 74), ('Standard Room', 5, 69), ('Standard Room', 6, 78),
  ('Ocean View', 1, 58), ('Ocean View', 2, 54), ('Ocean View', 3, 63), ('Ocean View', 4, 70), ('Ocean View', 5, 77), ('Ocean View', 6, 89),
  ('Family Suite', 1, 45), ('Family Suite', 2, 42), ('Family Suite', 3, 51), ('Family Suite', 4, 58), ('Family Suite', 5, 66), ('Family Suite', 6, 81)
ON CONFLICT (room_type, month) DO NOTHING;
