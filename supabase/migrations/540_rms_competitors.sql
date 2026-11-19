-- Migration: RMS Competitor Management
-- Real persistence for the Revenue Management → Competitors module
-- (docs/Revenue Management new.md). Stores competitor properties, their
-- room-type mappings to our property, and the rate samples collected
-- per room type / date.
--
-- Replaces the hardcoded mock arrays in CompetitorManagement.tsx.
-- The /api/rms-portal/competitors* endpoints read/write these tables
-- directly via the service role (same pattern as /api/hk-portal/*).

-- ============================================================================
-- rms_competitors
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_competitors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  star_rating     SMALLINT NOT NULL DEFAULT 4
                    CHECK (star_rating BETWEEN 1 AND 5),
  proximity       TEXT NOT NULL DEFAULT 'nearby'
                    CHECK (proximity IN ('same_area','nearby','city_wide')),
  distance_km     NUMERIC(5,2) DEFAULT 0,
  contact_email   TEXT,
  contact_phone   TEXT,
  website         TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  last_rate_update TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_comp_property ON rms_competitors(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_comp_active   ON rms_competitors(active);

-- ============================================================================
-- rms_competitor_room_mappings
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_competitor_room_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   UUID NOT NULL REFERENCES rms_competitors(id) ON DELETE CASCADE,
  our_room_type   TEXT NOT NULL,
  their_room_type TEXT NOT NULL,
  quality_score   NUMERIC(3,2) DEFAULT 1.00
                    CHECK (quality_score BETWEEN 0 AND 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_comp_map_comp ON rms_competitor_room_mappings(competitor_id);

-- ============================================================================
-- rms_competitor_rates
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_competitor_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   UUID NOT NULL REFERENCES rms_competitors(id) ON DELETE CASCADE,
  room_type       TEXT NOT NULL,
  rate_date       DATE NOT NULL,
  rate            NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'ETB',
  availability    BOOLEAN NOT NULL DEFAULT true,
  source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('api','manual')),
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_comp_rate_comp ON rms_competitor_rates(competitor_id);
CREATE INDEX IF NOT EXISTS idx_rms_comp_rate_date ON rms_competitor_rates(rate_date DESC);

-- ============================================================================
-- rms_competitor_analysis  (market positioning snapshot)
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_competitor_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   UUID NOT NULL REFERENCES rms_competitors(id) ON DELETE CASCADE,
  market_share    NUMERIC(5,2) DEFAULT 0,
  rate_position   TEXT DEFAULT 'competitive'
                    CHECK (rate_position IN ('premium','competitive','luxury','budget')),
  occupancy       NUMERIC(5,2) DEFAULT 0,
  adr             NUMERIC(12,2) DEFAULT 0,
  revpar          NUMERIC(12,2) DEFAULT 0,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_comp_an_comp ON rms_competitor_analysis(competitor_id);

-- ============================================================================
-- rms_parity_alerts
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_parity_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL,
  competitor_id   UUID REFERENCES rms_competitors(id) ON DELETE CASCADE,
  our_rate        NUMERIC(12,2) NOT NULL,
  competitor_rate NUMERIC(12,2) NOT NULL,
  variance_pct    NUMERIC(5,2) NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('high','medium','low')),
  resolved        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_parity_severity ON rms_parity_alerts(severity, resolved);

-- ============================================================================
-- updated_at maintenance
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_rms_comp_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_comp_updated_at ON rms_competitors;
CREATE TRIGGER trg_rms_comp_updated_at
  BEFORE UPDATE ON rms_competitors
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_comp_set_updated_at();

-- ============================================================================
-- RLS — authenticated users can read; only revenue managers can write.
-- ============================================================================
ALTER TABLE rms_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_competitor_room_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_competitor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_competitor_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_parity_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_comp_read_authenticated ON rms_competitors;
CREATE POLICY rms_comp_read_authenticated
  ON rms_competitors FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rms_comp_write_revenue ON rms_competitors;
CREATE POLICY rms_comp_write_revenue
  ON rms_competitors FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_comp_map_read ON rms_competitor_room_mappings;
CREATE POLICY rms_comp_map_read
  ON rms_competitor_room_mappings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_comp_map_write ON rms_competitor_room_mappings;
CREATE POLICY rms_comp_map_write
  ON rms_competitor_room_mappings FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_comp_rate_read ON rms_competitor_rates;
CREATE POLICY rms_comp_rate_read
  ON rms_competitor_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_comp_rate_write ON rms_competitor_rates;
CREATE POLICY rms_comp_rate_write
  ON rms_competitor_rates FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_comp_an_read ON rms_competitor_analysis;
CREATE POLICY rms_comp_an_read
  ON rms_competitor_analysis FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_comp_an_write ON rms_competitor_analysis;
CREATE POLICY rms_comp_an_write
  ON rms_competitor_analysis FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

DROP POLICY IF EXISTS rms_parity_read ON rms_parity_alerts;
CREATE POLICY rms_parity_read
  ON rms_parity_alerts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_parity_write ON rms_parity_alerts;
CREATE POLICY rms_parity_write
  ON rms_parity_alerts FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner'));

-- ============================================================================
-- Seed mock data (mirrors the previous in-component mock arrays so the
-- Competitors module has content immediately after migration).
-- ============================================================================
INSERT INTO rms_competitors
  (name, star_rating, proximity, distance_km, contact_email, contact_phone, website, active, last_rate_update)
VALUES
  ('Hotel A', 4, 'same_area', 0.5,  'rates@hotela.com',       '+251 911 123 456', 'https://hotela.com', true, '2026-07-19T10:00:00Z'),
  ('Hotel B', 3, 'nearby',    1.2,  'reservations@hotelb.com', '+251 911 234 567', 'https://hotelb.com', true, '2026-07-19T09:30:00Z'),
  ('Hotel C', 5, 'city_wide', 3.5,  'sales@hotelc.com',       '+251 911 345 678', 'https://hotelc.com', true, '2026-07-19T08:00:00Z')
ON CONFLICT DO NOTHING;

-- Room mappings (reference the seeded competitors by name lookup)
INSERT INTO rms_competitor_room_mappings (competitor_id, our_room_type, their_room_type, quality_score)
SELECT id, 'Deluxe Suite',   'Executive Suite', 0.90 FROM rms_competitors WHERE name = 'Hotel A'
UNION ALL SELECT id, 'Standard Room', 'Standard Room',   1.00 FROM rms_competitors WHERE name = 'Hotel A'
UNION ALL SELECT id, 'Deluxe Suite',   'Deluxe Room',     0.85 FROM rms_competitors WHERE name = 'Hotel B'
UNION ALL SELECT id, 'Ocean View',    'Ocean Suite',     0.95 FROM rms_competitors WHERE name = 'Hotel C'
UNION ALL SELECT id, 'Family Suite',  'Family Room',     0.88 FROM rms_competitors WHERE name = 'Hotel C'
ON CONFLICT DO NOTHING;

-- Rates
INSERT INTO rms_competitor_rates (competitor_id, room_type, rate_date, rate, currency, availability, source, collected_at)
SELECT id, 'Deluxe Suite',   DATE '2026-07-19', 155, 'ETB', true,  'api', '2026-07-19T10:00:00Z'::timestamptz FROM rms_competitors WHERE name = 'Hotel A'
UNION ALL SELECT id, 'Standard Room', DATE '2026-07-19', 105, 'ETB', true,  'api', '2026-07-19T10:00:00Z'::timestamptz FROM rms_competitors WHERE name = 'Hotel A'
UNION ALL SELECT id, 'Deluxe Suite',   DATE '2026-07-19', 145, 'ETB', true,  'api', '2026-07-19T09:30:00Z'::timestamptz FROM rms_competitors WHERE name = 'Hotel B'
UNION ALL SELECT id, 'Ocean View',    DATE '2026-07-19', 195, 'ETB', false, 'api', '2026-07-19T08:00:00Z'::timestamptz FROM rms_competitors WHERE name = 'Hotel C'
ON CONFLICT DO NOTHING;

-- Analysis
INSERT INTO rms_competitor_analysis (competitor_id, market_share, rate_position, occupancy, adr, revpar, snapshot_date)
SELECT id, 22, 'premium',      78, 145, 113, DATE '2026-07-19' FROM rms_competitors WHERE name = 'Hotel A'
UNION ALL SELECT id, 18, 'competitive',  82, 138, 113, DATE '2026-07-19' FROM rms_competitors WHERE name = 'Hotel B'
UNION ALL SELECT id, 15, 'luxury',       75, 152, 114, DATE '2026-07-19' FROM rms_competitors WHERE name = 'Hotel C'
ON CONFLICT DO NOTHING;

-- Parity alerts
INSERT INTO rms_parity_alerts (channel, competitor_id, our_rate, competitor_rate, variance_pct, severity, resolved)
SELECT 'Booking.com', id, 150, 135, -10, 'high',   false FROM rms_competitors WHERE name = 'Hotel A'
UNION ALL SELECT 'Expedia',    id, 150, 145, -3,  'medium', false FROM rms_competitors WHERE name = 'Hotel B'
ON CONFLICT DO NOTHING;
