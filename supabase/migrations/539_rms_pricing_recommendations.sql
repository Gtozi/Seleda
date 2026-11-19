-- Migration: RMS Pricing Recommendations
-- Real persistence for the Revenue Management → Recommendations module
-- (docs/Revenue Management new.md). Stores AI-generated rate adjustment
-- suggestions with an approval workflow (pending / approved / rejected /
-- applied) and the factor breakdown that justified each recommendation.
--
-- Replaces the hardcoded mock array in PricingRecommendations.tsx.
-- The /api/rms-portal/recommendations endpoints read/write this table
-- directly via the service role (same pattern as /api/hk-portal/*).

-- ============================================================================
-- rms_pricing_recommendations
-- ============================================================================
CREATE TABLE IF NOT EXISTS rms_pricing_recommendations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id          TEXT NOT NULL,
  room_type              TEXT NOT NULL,
  recommendation_date    DATE NOT NULL,
  current_rate           NUMERIC(12,2) NOT NULL,
  recommended_rate       NUMERIC(12,2) NOT NULL,
  confidence            SMALLINT NOT NULL DEFAULT 0
                          CHECK (confidence BETWEEN 0 AND 100),
  reason                TEXT,
  demand_score          SMALLINT DEFAULT 0,
  competitor_avg        NUMERIC(12,2) DEFAULT 0,
  occupancy_forecast    SMALLINT DEFAULT 0,
  seasonality           NUMERIC(5,2) DEFAULT 1.0,
  events_impact         NUMERIC(5,2) DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','applied')),
  applied_by            TEXT,
  applied_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_rec_property   ON rms_pricing_recommendations(property_id);
CREATE INDEX IF NOT EXISTS idx_rms_rec_status     ON rms_pricing_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_rms_rec_room_type  ON rms_pricing_recommendations(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rms_rec_date       ON rms_pricing_recommendations(recommendation_date DESC);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.trg_rms_rec_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_rec_updated_at ON rms_pricing_recommendations;
CREATE TRIGGER trg_rms_rec_updated_at
  BEFORE UPDATE ON rms_pricing_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_rec_set_updated_at();

-- ============================================================================
-- RLS — authenticated users can read; only revenue managers can write.
-- ============================================================================
ALTER TABLE rms_pricing_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_rec_read_authenticated ON rms_pricing_recommendations;
CREATE POLICY rms_rec_read_authenticated
  ON rms_pricing_recommendations
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS rms_rec_write_revenue ON rms_pricing_recommendations;
CREATE POLICY rms_rec_write_revenue
  ON rms_pricing_recommendations
  FOR ALL
  TO authenticated
  USING (
    auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner')
  )
  WITH CHECK (
    auth.jwt() ->> 'role' IN ('revenue_manager','revenue','admin','superuser','owner')
  );

-- ============================================================================
-- Seed mock data (mirrors the previous in-component mock array so the
-- Recommendations module has content immediately after migration).
-- ============================================================================
INSERT INTO rms_pricing_recommendations
  (room_type_id, room_type, recommendation_date, current_rate, recommended_rate,
   confidence, reason, demand_score, competitor_avg, occupancy_forecast,
   seasonality, events_impact, status, applied_by, applied_at, created_at)
VALUES
  ('rt-1','Deluxe Suite',  '2026-07-20', 150, 165, 92,
   'High demand forecast due to local conference',
   85, 158, 88, 1.10, 15, 'pending', NULL, NULL, '2026-07-19T10:00:00Z'),
  ('rt-2','Standard Room', '2026-07-20', 100, 105, 85,
   'Competitor rate increase detected',
   72, 108, 75, 1.00, 0, 'pending', NULL, NULL, '2026-07-19T10:00:00Z'),
  ('rt-3','Ocean View',    '2026-07-21', 200, 190, 78,
   'Low occupancy forecast - reduce to stimulate demand',
   55, 195, 60, 0.90, -5, 'pending', NULL, NULL, '2026-07-19T10:00:00Z'),
  ('rt-4','Family Suite',  '2026-07-22', 250, 275, 88,
   'Weekend demand surge expected',
   90, 265, 92, 1.15, 10, 'pending', NULL, NULL, '2026-07-19T10:00:00Z'),
  ('rt-1','Deluxe Suite',  '2026-07-19', 145, 160, 90,
   'High demand forecast',
   82, 155, 85, 1.05, 8, 'approved', 'John Doe', '2026-07-19T09:30:00Z',
   '2026-07-19T08:00:00Z'),
  ('rt-2','Standard Room', '2026-07-18', 95, 110, 75,
   'Competitor rate increase',
   68, 105, 70, 1.00, 0, 'rejected', 'Jane Smith', '2026-07-18T14:00:00Z',
   '2026-07-18T10:00:00Z')
ON CONFLICT DO NOTHING;
