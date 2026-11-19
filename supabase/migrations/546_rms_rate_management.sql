-- RMS Rate Management module.
-- Stores rate plans, seasonal rate adjustments, and weekend differential rates.

CREATE TABLE IF NOT EXISTS rms_rate_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  plan_type       TEXT NOT NULL DEFAULT 'Standard',
  base_rate       NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  active          BOOLEAN NOT NULL DEFAULT true,
  description     TEXT,
  features        TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, code)
);

CREATE TABLE IF NOT EXISTS rms_seasonal_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  adjustment      NUMERIC(6,2) NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_weekend_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  weekday_rate    NUMERIC(12,2) NOT NULL DEFAULT 0,
  weekend_rate    NUMERIC(12,2) NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, room_type)
);

CREATE INDEX IF NOT EXISTS idx_rms_rate_plans_property ON rms_rate_plans(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_seasonal_property ON rms_seasonal_rates(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_weekend_property ON rms_weekend_rates(property_id);

CREATE OR REPLACE FUNCTION public.trg_rms_rate_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_rate_plan_updated ON rms_rate_plans;
CREATE TRIGGER trg_rms_rate_plan_updated
  BEFORE UPDATE ON rms_rate_plans
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_rate_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_seasonal_updated ON rms_seasonal_rates;
CREATE TRIGGER trg_rms_seasonal_updated
  BEFORE UPDATE ON rms_seasonal_rates
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_rate_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_weekend_updated ON rms_weekend_rates;
CREATE TRIGGER trg_rms_weekend_updated
  BEFORE UPDATE ON rms_weekend_rates
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_rate_set_updated_at();

ALTER TABLE rms_rate_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_seasonal_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_weekend_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_rate_plan_read ON rms_rate_plans;
CREATE POLICY rms_rate_plan_read ON rms_rate_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_rate_plan_write ON rms_rate_plans;
CREATE POLICY rms_rate_plan_write ON rms_rate_plans FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_seasonal_read ON rms_seasonal_rates;
CREATE POLICY rms_seasonal_read ON rms_seasonal_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_seasonal_write ON rms_seasonal_rates;
CREATE POLICY rms_seasonal_write ON rms_seasonal_rates FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_weekend_read ON rms_weekend_rates;
CREATE POLICY rms_weekend_read ON rms_weekend_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_weekend_write ON rms_weekend_rates;
CREATE POLICY rms_weekend_write ON rms_weekend_rates FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_rate_plans (name, code, plan_type, base_rate, currency, active, description, features) VALUES
  ('BAR (Best Available Rate)', 'BAR', 'Standard', 150, 'USD', true, 'Standard rate for all guests', ARRAY['Flexible cancellation','Free WiFi','Breakfast included']),
  ('Corporate Rate', 'CORP', 'Corporate', 120, 'USD', true, 'Negotiated corporate rates', ARRAY['Flexible cancellation','Free WiFi','Breakfast included','Late checkout']),
  ('Government Rate', 'GOV', 'Government', 100, 'USD', true, 'Government employee rates', ARRAY['ID required','Free WiFi','Breakfast included']),
  ('OTA Rate', 'OTA', 'OTA', 165, 'USD', true, 'Online Travel Agency rates', ARRAY['Commission included','Free WiFi','Breakfast included']),
  ('Package Rate', 'PKG', 'Package', 200, 'USD', true, 'Room + dining package', ARRAY['Dining credit','Free WiFi','Breakfast included','Spa access']),
  ('Loyalty Rate', 'LOY', 'Loyalty', 135, 'USD', true, 'Member exclusive rates', ARRAY['Member only','Free WiFi','Breakfast included','Points earned'])
ON CONFLICT (property_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  plan_type = EXCLUDED.plan_type,
  base_rate = EXCLUDED.base_rate,
  currency = EXCLUDED.currency,
  active = EXCLUDED.active,
  description = EXCLUDED.description,
  features = EXCLUDED.features;

INSERT INTO rms_seasonal_rates (name, start_date, end_date, adjustment, active) VALUES
  ('Peak Season', DATE '2024-12-15', DATE '2025-01-15', 30, true),
  ('High Season', DATE '2024-06-01', DATE '2024-08-31', 20, true),
  ('Shoulder Season', DATE '2024-04-01', DATE '2024-05-31', 10, true),
  ('Low Season', DATE '2024-09-01', DATE '2024-11-30', -15, true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_weekend_rates (room_type, weekday_rate, weekend_rate, active) VALUES
  ('Deluxe Suite', 150, 180, true),
  ('Standard Room', 100, 120, true),
  ('Ocean View', 200, 240, true)
ON CONFLICT (property_id, room_type) DO UPDATE SET
  weekday_rate = EXCLUDED.weekday_rate,
  weekend_rate = EXCLUDED.weekend_rate,
  active = EXCLUDED.active;
