-- RMS Overbooking Management module.
-- Replaces hardcoded mock data in OverbookingManagement.tsx.

CREATE TABLE IF NOT EXISTS rms_overbooking_limits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  room_type         TEXT NOT NULL,
  total_rooms       INTEGER NOT NULL DEFAULT 0,
  overbook_limit    INTEGER NOT NULL DEFAULT 0,
  current_overbook  INTEGER NOT NULL DEFAULT 0,
  risk_level        TEXT NOT NULL DEFAULT 'low',
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_wash_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,
  cancellations   INTEGER NOT NULL DEFAULT 0,
  no_shows        INTEGER NOT NULL DEFAULT 0,
  wash_rate       NUMERIC(6,2) NOT NULL DEFAULT 0,
  expected_wash   NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_cancellation_trends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  segment         TEXT NOT NULL,
  rate            NUMERIC(6,2) NOT NULL DEFAULT 0,
  trend           TEXT NOT NULL DEFAULT 'stable',
  change          NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_noshow_predictions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID REFERENCES properties(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  room_type           TEXT NOT NULL,
  bookings            INTEGER NOT NULL DEFAULT 0,
  predicted_no_shows  INTEGER NOT NULL DEFAULT 0,
  confidence          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_walk_partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  partner         TEXT NOT NULL,
  distance        TEXT,
  rate            TEXT,
  agreement       TEXT NOT NULL DEFAULT 'pending',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_risk_assessment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  room_type       TEXT NOT NULL DEFAULT 'All',
  overbook_count  INTEGER NOT NULL DEFAULT 0,
  risk_level      TEXT NOT NULL DEFAULT 'low',
  factors         TEXT[] NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_overbook_room ON rms_overbooking_limits(room_type);
CREATE INDEX IF NOT EXISTS idx_rms_wash_period ON rms_wash_analysis(period);
CREATE INDEX IF NOT EXISTS idx_rms_cancel_segment ON rms_cancellation_trends(segment);
CREATE INDEX IF NOT EXISTS idx_rms_noshow_date ON rms_noshow_predictions(date);
CREATE INDEX IF NOT EXISTS idx_rms_walk_partner ON rms_walk_partners(partner);
CREATE INDEX IF NOT EXISTS idx_rms_risk_date ON rms_risk_assessment(date);

CREATE OR REPLACE FUNCTION public.trg_rms_overbooking_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_overbook_updated ON rms_overbooking_limits;
CREATE TRIGGER trg_rms_overbook_updated BEFORE UPDATE ON rms_overbooking_limits FOR EACH ROW EXECUTE FUNCTION public.trg_rms_overbooking_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_wash_updated ON rms_wash_analysis;
CREATE TRIGGER trg_rms_wash_updated BEFORE UPDATE ON rms_wash_analysis FOR EACH ROW EXECUTE FUNCTION public.trg_rms_overbooking_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_cancel_updated ON rms_cancellation_trends;
CREATE TRIGGER trg_rms_cancel_updated BEFORE UPDATE ON rms_cancellation_trends FOR EACH ROW EXECUTE FUNCTION public.trg_rms_overbooking_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_noshow_updated ON rms_noshow_predictions;
CREATE TRIGGER trg_rms_noshow_updated BEFORE UPDATE ON rms_noshow_predictions FOR EACH ROW EXECUTE FUNCTION public.trg_rms_overbooking_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_walk_updated ON rms_walk_partners;
CREATE TRIGGER trg_rms_walk_updated BEFORE UPDATE ON rms_walk_partners FOR EACH ROW EXECUTE FUNCTION public.trg_rms_overbooking_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_risk_updated ON rms_risk_assessment;
CREATE TRIGGER trg_rms_risk_updated BEFORE UPDATE ON rms_risk_assessment FOR EACH ROW EXECUTE FUNCTION public.trg_rms_overbooking_set_updated_at();

ALTER TABLE rms_overbooking_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_wash_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_cancellation_trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_noshow_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_walk_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_risk_assessment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_overbook_read ON rms_overbooking_limits;
CREATE POLICY rms_overbook_read ON rms_overbooking_limits FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_overbook_write ON rms_overbooking_limits;
CREATE POLICY rms_overbook_write ON rms_overbooking_limits FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_wash_read ON rms_wash_analysis;
CREATE POLICY rms_wash_read ON rms_wash_analysis FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_wash_write ON rms_wash_analysis;
CREATE POLICY rms_wash_write ON rms_wash_analysis FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_cancel_read ON rms_cancellation_trends;
CREATE POLICY rms_cancel_read ON rms_cancellation_trends FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_cancel_write ON rms_cancellation_trends;
CREATE POLICY rms_cancel_write ON rms_cancellation_trends FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_noshow_read ON rms_noshow_predictions;
CREATE POLICY rms_noshow_read ON rms_noshow_predictions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_noshow_write ON rms_noshow_predictions;
CREATE POLICY rms_noshow_write ON rms_noshow_predictions FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_walk_read ON rms_walk_partners;
CREATE POLICY rms_walk_read ON rms_walk_partners FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_walk_write ON rms_walk_partners;
CREATE POLICY rms_walk_write ON rms_walk_partners FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_risk_read ON rms_risk_assessment;
CREATE POLICY rms_risk_read ON rms_risk_assessment FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_risk_write ON rms_risk_assessment;
CREATE POLICY rms_risk_write ON rms_risk_assessment FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_overbooking_limits (room_type, total_rooms, overbook_limit, current_overbook, risk_level, active) VALUES
  ('Deluxe Suite', 50, 5, 3, 'medium', true),
  ('Standard Room', 100, 10, 8, 'high', true),
  ('Ocean View', 30, 3, 1, 'low', true),
  ('Family Suite', 25, 4, 2, 'medium', true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_wash_analysis (period, cancellations, no_shows, wash_rate, expected_wash) VALUES
  ('Last 7 days', 12, 5, 17, 15),
  ('Last 30 days', 45, 18, 16, 15),
  ('Last 90 days', 135, 52, 15.5, 15)
ON CONFLICT DO NOTHING;

INSERT INTO rms_cancellation_trends (segment, rate, trend, change) VALUES
  ('Leisure', 12, 'up', 2),
  ('Corporate', 8, 'down', -1),
  ('Group', 5, 'stable', 0),
  ('OTA', 15, 'up', 3)
ON CONFLICT DO NOTHING;

INSERT INTO rms_noshow_predictions (date, room_type, bookings, predicted_no_shows, confidence) VALUES
  (DATE '2024-12-15', 'Deluxe Suite', 45, 4, 85),
  (DATE '2024-12-16', 'Standard Room', 92, 9, 82),
  (DATE '2024-12-17', 'Ocean View', 28, 2, 78)
ON CONFLICT DO NOTHING;

INSERT INTO rms_walk_partners (partner, distance, rate, agreement, active) VALUES
  ('Hotel A (4-star)', '0.5 km', '$160', 'active', true),
  ('Hotel B (3-star)', '1.2 km', '$120', 'active', true),
  ('Hotel C (5-star)', '2.0 km', '$200', 'pending', true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_risk_assessment (date, room_type, overbook_count, risk_level, factors, active) VALUES
  (DATE '2024-12-24', 'All', 12, 'high', ARRAY['Holiday period','High demand','Low wash expected'], true),
  (DATE '2024-12-25', 'All', 15, 'critical', ARRAY['Christmas Day','Historically low no-show','Limited walk options'], true),
  (DATE '2024-12-31', 'All', 8, 'medium', ARRAY['New Year''s Eve','Moderate demand','Good walk availability'], true)
ON CONFLICT DO NOTHING;
