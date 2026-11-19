-- RMS Restrictions Management module.
-- Replaces hardcoded mock restrictions and alerts in RestrictionsManagement.tsx.

CREATE TABLE IF NOT EXISTS rms_restrictions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  restriction_type  TEXT NOT NULL, -- 'los','cta','ctd','stopsell','rate','booking'
  room_type         TEXT NOT NULL,
  dates             TEXT NOT NULL DEFAULT 'All dates',
  min_nights        INTEGER,
  max_nights        INTEGER,
  reason            TEXT,
  min_rate          NUMERIC(12,2),
  max_rate          NUMERIC(12,2),
  min_advance       INTEGER,
  max_advance       INTEGER,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_restriction_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL DEFAULT 'info',
  message         TEXT NOT NULL,
  date_range      TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_restriction_type ON rms_restrictions(restriction_type);
CREATE INDEX IF NOT EXISTS idx_rms_restriction_room ON rms_restrictions(room_type);
CREATE INDEX IF NOT EXISTS idx_rms_restriction_alert ON rms_restriction_alerts(active);

CREATE OR REPLACE FUNCTION public.trg_rms_restrictions_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_restriction_updated ON rms_restrictions;
CREATE TRIGGER trg_rms_restriction_updated BEFORE UPDATE ON rms_restrictions FOR EACH ROW EXECUTE FUNCTION public.trg_rms_restrictions_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_restriction_alert_updated ON rms_restriction_alerts;
CREATE TRIGGER trg_rms_restriction_alert_updated BEFORE UPDATE ON rms_restriction_alerts FOR EACH ROW EXECUTE FUNCTION public.trg_rms_restrictions_set_updated_at();

ALTER TABLE rms_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_restriction_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_restriction_read ON rms_restrictions;
CREATE POLICY rms_restriction_read ON rms_restrictions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_restriction_write ON rms_restrictions;
CREATE POLICY rms_restriction_write ON rms_restrictions FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_restriction_alert_read ON rms_restriction_alerts;
CREATE POLICY rms_restriction_alert_read ON rms_restriction_alerts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_restriction_alert_write ON rms_restriction_alerts;
CREATE POLICY rms_restriction_alert_write ON rms_restriction_alerts FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_restrictions (restriction_type, room_type, dates, min_nights, max_nights, reason, min_rate, max_rate, min_advance, max_advance, active) VALUES
  ('los', 'Deluxe Suite', '2024-12-15 to 2024-12-31', 2, 14, NULL, NULL, NULL, NULL, NULL, true),
  ('los', 'Standard Room', 'All dates', 1, 30, NULL, NULL, NULL, NULL, NULL, true),
  ('los', 'Ocean View', '2024-12-20 to 2024-12-26', 3, 7, NULL, NULL, NULL, NULL, NULL, true),
  ('cta', 'Deluxe Suite', '2024-12-24 to 2024-12-26', NULL, NULL, 'Christmas', NULL, NULL, NULL, NULL, true),
  ('cta', 'All Room Types', '2024-12-31', NULL, NULL, 'New Year''s Eve', NULL, NULL, NULL, NULL, true),
  ('ctd', 'Family Suite', '2024-12-25', NULL, NULL, 'Christmas Day', NULL, NULL, NULL, NULL, true),
  ('stopsell', 'Ocean View', '2024-12-20 to 2024-12-31', NULL, NULL, 'Holiday period', NULL, NULL, NULL, NULL, true),
  ('stopsell', 'Deluxe Suite', '2024-12-24 to 2024-12-26', NULL, NULL, 'Christmas', NULL, NULL, NULL, NULL, false),
  ('rate', 'Standard Room', 'All dates', NULL, NULL, NULL, 100, 200, NULL, NULL, true),
  ('rate', 'Deluxe Suite', '2024-12-15 to 2024-12-31', NULL, NULL, NULL, 150, 300, NULL, NULL, true),
  ('booking', 'All Room Types', 'All dates', NULL, NULL, NULL, NULL, NULL, 1, 365, true),
  ('booking', 'Deluxe Suite', 'Peak season', NULL, NULL, NULL, NULL, NULL, 7, 180, true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_restriction_alerts (alert_type, message, date_range, active) VALUES
  ('warning', 'Stop Sell active for Ocean View during holiday period', '2024-12-20 to 2024-12-31', true),
  ('info', 'MinLOS of 3 nights required for Ocean View during Christmas', '2024-12-20 to 2024-12-26', true),
  ('error', 'CTA active for all room types on New Year''s Eve', '2024-12-31', true)
ON CONFLICT DO NOTHING;
