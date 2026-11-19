-- RMS Market Segmentation module.
-- Replaces hardcoded mock segment data in MarketSegmentation.tsx.

CREATE TABLE IF NOT EXISTS rms_market_segments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  icon_name       TEXT,
  revenue         NUMERIC(14,2) NOT NULL DEFAULT 0,
  adr             NUMERIC(12,2) NOT NULL DEFAULT 0,
  revpar          NUMERIC(12,2) NOT NULL DEFAULT 0,
  occupancy       NUMERIC(6,2) NOT NULL DEFAULT 0,
  profitability   NUMERIC(6,2) NOT NULL DEFAULT 0,
  growth          NUMERIC(6,2) NOT NULL DEFAULT 0,
  color           TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, code)
);

CREATE INDEX IF NOT EXISTS idx_rms_segment_code ON rms_market_segments(code);
CREATE INDEX IF NOT EXISTS idx_rms_segment_revenue ON rms_market_segments(revenue DESC);

CREATE OR REPLACE FUNCTION public.trg_rms_segment_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_segment_updated ON rms_market_segments;
CREATE TRIGGER trg_rms_segment_updated
  BEFORE UPDATE ON rms_market_segments
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_segment_set_updated_at();

ALTER TABLE rms_market_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_segment_read ON rms_market_segments;
CREATE POLICY rms_segment_read ON rms_market_segments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_segment_write ON rms_market_segments;
CREATE POLICY rms_segment_write ON rms_market_segments FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_market_segments (code, name, icon_name, revenue, adr, revpar, occupancy, profitability, growth, color, active) VALUES
  ('leisure', 'Leisure', 'Users', 125000, 145, 113, 78, 32, 12, 'blue', true),
  ('corporate', 'Corporate', 'Briefcase', 98000, 165, 132, 80, 38, 8, 'green', true),
  ('government', 'Government', 'Building', 45000, 110, 88, 80, 25, 5, 'purple', true),
  ('group', 'Group', 'Users', 78000, 130, 104, 80, 28, 15, 'orange', true),
  ('airline', 'Airline Crew', 'Plane', 35000, 95, 76, 80, 22, -3, 'red', true),
  ('wholesale', 'Wholesale', 'Package', 52000, 115, 92, 80, 20, 6, 'amber', true),
  ('ota', 'OTA', 'Globe', 89000, 155, 124, 80, 18, 18, 'cyan', true),
  ('direct', 'Direct', 'Phone', 67000, 140, 112, 80, 35, 10, 'emerald', true),
  ('loyalty', 'Loyalty', 'Star', 28000, 135, 108, 80, 30, 22, 'yellow', true)
ON CONFLICT (property_id, code) DO UPDATE SET
  name = EXCLUDED.name, icon_name = EXCLUDED.icon_name, revenue = EXCLUDED.revenue,
  adr = EXCLUDED.adr, revpar = EXCLUDED.revpar, occupancy = EXCLUDED.occupancy,
  profitability = EXCLUDED.profitability, growth = EXCLUDED.growth, color = EXCLUDED.color,
  active = EXCLUDED.active;
