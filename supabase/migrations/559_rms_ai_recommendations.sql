-- RMS AI Recommendations module.
-- Replaces hardcoded mock recommendations and insights in AIRecommendations.tsx.

CREATE TABLE IF NOT EXISTS rms_ai_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  rec_type          TEXT NOT NULL, -- 'pricing','inventory','distribution','promotional'
  priority          TEXT NOT NULL DEFAULT 'medium', -- 'high','medium','low'
  title             TEXT NOT NULL,
  description       TEXT,
  room_type         TEXT,
  channel           TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb, -- current/recommended pairs per type
  potential_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  confidence        INTEGER NOT NULL DEFAULT 0,
  timeframe         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending','applied','dismissed'
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_ai_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  icon          TEXT NOT NULL DEFAULT 'trending_up', -- 'trending_up','alert','globe','zap'
  color         TEXT NOT NULL DEFAULT 'blue', -- 'green','amber','blue','purple'
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_ai_rec_type ON rms_ai_recommendations(rec_type);
CREATE INDEX IF NOT EXISTS idx_rms_ai_rec_status ON rms_ai_recommendations(status);

CREATE OR REPLACE FUNCTION public.trg_rms_ai_recs_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_ai_rec_updated ON rms_ai_recommendations;
CREATE TRIGGER trg_rms_ai_rec_updated BEFORE UPDATE ON rms_ai_recommendations FOR EACH ROW EXECUTE FUNCTION public.trg_rms_ai_recs_set_updated_at();

ALTER TABLE rms_ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_ai_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_ai_rec_read ON rms_ai_recommendations;
CREATE POLICY rms_ai_rec_read ON rms_ai_recommendations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_ai_rec_write ON rms_ai_recommendations;
CREATE POLICY rms_ai_rec_write ON rms_ai_recommendations FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_ai_insight_read ON rms_ai_insights;
CREATE POLICY rms_ai_insight_read ON rms_ai_insights FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_ai_insight_write ON rms_ai_insights;
CREATE POLICY rms_ai_insight_write ON rms_ai_insights FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_ai_recommendations (rec_type, priority, title, description, room_type, channel, details, potential_revenue, confidence, timeframe, status, reason) VALUES
  ('pricing', 'high', 'Increase Deluxe Suite rate by 15%', 'High demand forecast for next 30 days. Competitor rates increased by 12%.', 'Deluxe Suite', NULL, '{"currentRate":150,"recommendedRate":172}'::jsonb, 4500, 92, 'Next 30 days', 'pending', 'Demand surge + competitor pricing'),
  ('inventory', 'medium', 'Release 10 rooms from OTA allocation', 'Direct bookings performing better. Shift inventory to direct channel.', 'Standard Room', NULL, '{"currentAllocation":50,"recommendedAllocation":40}'::jsonb, 2200, 85, 'Immediate', 'pending', 'Channel performance optimization'),
  ('distribution', 'high', 'Enable Expedia rate parity check', 'Rate parity violation detected. Enable automatic parity monitoring.', NULL, 'Expedia', '{"currentStatus":"manual","recommendedStatus":"automatic"}'::jsonb, 1800, 88, 'Immediate', 'pending', 'Rate parity violation'),
  ('promotional', 'low', 'Launch flash sale for Ocean View', 'Low occupancy forecast. Consider 20% flash sale for 3-day period.', 'Ocean View', NULL, '{"currentOccupancy":65,"targetOccupancy":80}'::jsonb, 3200, 78, 'Next 7 days', 'pending', 'Occupancy optimization'),
  ('pricing', 'medium', 'Adjust weekend rates for Family Suite', 'Weekend demand lower than expected. Reduce weekend premium by 5%.', 'Family Suite', NULL, '{"currentWeekendRate":180,"recommendedWeekendRate":171}'::jsonb, 900, 82, 'Next weekend', 'pending', 'Demand adjustment'),
  ('inventory', 'high', 'Increase overbooking limit for peak season', 'Historical wash rate 15% during holidays. Safe to increase overbooking.', 'All Room Types', NULL, '{"currentLimit":10,"recommendedLimit":15}'::jsonb, 7500, 90, 'Holiday season', 'pending', 'Wash rate analysis')
ON CONFLICT DO NOTHING;

INSERT INTO rms_ai_insights (title, description, icon, color, display_order) VALUES
  ('Demand Pattern Detected', 'Leisure demand increasing 15% YoY for December. Consider extending high-season pricing.', 'trending_up', 'green', 1),
  ('Competitor Activity Alert', '3 nearby hotels increased rates by 10-15% for holiday period. Market pricing opportunity.', 'alert', 'amber', 2),
  ('Channel Shift Opportunity', 'Direct bookings up 22% while OTA bookings down 8%. Shift inventory allocation recommended.', 'globe', 'blue', 3),
  ('Package Performance Insight', 'Spa packages showing 35% higher conversion than room-only. Consider bundling more packages.', 'zap', 'purple', 4)
ON CONFLICT DO NOTHING;
