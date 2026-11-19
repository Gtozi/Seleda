-- RMS Distribution Management module.
-- Replaces hardcoded mock channel status, parity issues, rules, and sync schedule in DistributionManagement.tsx.

CREATE TABLE IF NOT EXISTS rms_distribution_channels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'connected',
  last_sync         TEXT,
  availability_sync BOOLEAN NOT NULL DEFAULT false,
  rate_sync         BOOLEAN NOT NULL DEFAULT false,
  booking_sync      BOOLEAN NOT NULL DEFAULT false,
  parity_status     TEXT NOT NULL DEFAULT 'unknown',
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, code)
);

CREATE TABLE IF NOT EXISTS rms_rate_parity_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  room_type       TEXT NOT NULL,
  our_rate        NUMERIC(12,2) NOT NULL DEFAULT 0,
  channel_rate    NUMERIC(12,2) NOT NULL DEFAULT 0,
  diff_percent    NUMERIC(6,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'warning',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_distribution_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  room_type       TEXT NOT NULL,
  allocation      INTEGER NOT NULL DEFAULT 0,
  restriction     TEXT NOT NULL DEFAULT 'None',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_sync_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  sync_type       TEXT NOT NULL,
  frequency       TEXT NOT NULL,
  last_run        TEXT,
  next_run        TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_dist_channel_code ON rms_distribution_channels(code);
CREATE INDEX IF NOT EXISTS idx_rms_parity_status ON rms_rate_parity_issues(status);
CREATE INDEX IF NOT EXISTS idx_rms_dist_rule_channel ON rms_distribution_rules(channel);
CREATE INDEX IF NOT EXISTS idx_rms_sync_type ON rms_sync_schedule(sync_type);

CREATE OR REPLACE FUNCTION public.trg_rms_dist_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_dist_channel_updated ON rms_distribution_channels;
CREATE TRIGGER trg_rms_dist_channel_updated
  BEFORE UPDATE ON rms_distribution_channels
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dist_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_parity_issue_updated ON rms_rate_parity_issues;
CREATE TRIGGER trg_rms_parity_issue_updated
  BEFORE UPDATE ON rms_rate_parity_issues
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dist_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_dist_rule_updated ON rms_distribution_rules;
CREATE TRIGGER trg_rms_dist_rule_updated
  BEFORE UPDATE ON rms_distribution_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dist_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_sync_schedule_updated ON rms_sync_schedule;
CREATE TRIGGER trg_rms_sync_schedule_updated
  BEFORE UPDATE ON rms_sync_schedule
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dist_set_updated_at();

ALTER TABLE rms_distribution_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_rate_parity_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_distribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_sync_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_dist_channel_read ON rms_distribution_channels;
CREATE POLICY rms_dist_channel_read ON rms_distribution_channels FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_dist_channel_write ON rms_distribution_channels;
CREATE POLICY rms_dist_channel_write ON rms_distribution_channels FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_parity_read ON rms_rate_parity_issues;
CREATE POLICY rms_parity_read ON rms_rate_parity_issues FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_parity_write ON rms_rate_parity_issues;
CREATE POLICY rms_parity_write ON rms_rate_parity_issues FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_dist_rule_read ON rms_distribution_rules;
CREATE POLICY rms_dist_rule_read ON rms_distribution_rules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_dist_rule_write ON rms_distribution_rules;
CREATE POLICY rms_dist_rule_write ON rms_distribution_rules FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_sync_read ON rms_sync_schedule;
CREATE POLICY rms_sync_read ON rms_sync_schedule FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_sync_write ON rms_sync_schedule;
CREATE POLICY rms_sync_write ON rms_sync_schedule FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_distribution_channels (code, name, status, last_sync, availability_sync, rate_sync, booking_sync, parity_status, active) VALUES
  ('booking', 'Booking.com', 'connected', '10 min ago', true, true, true, 'ok', true),
  ('expedia', 'Expedia', 'connected', '15 min ago', true, true, true, 'violation', true),
  ('airbnb', 'Airbnb', 'connected', '20 min ago', true, true, false, 'ok', true),
  ('agoda', 'Agoda', 'disconnected', '2 hours ago', false, false, false, 'unknown', true)
ON CONFLICT (property_id, code) DO UPDATE SET
  name = EXCLUDED.name, status = EXCLUDED.status, last_sync = EXCLUDED.last_sync,
  availability_sync = EXCLUDED.availability_sync, rate_sync = EXCLUDED.rate_sync,
  booking_sync = EXCLUDED.booking_sync, parity_status = EXCLUDED.parity_status, active = EXCLUDED.active;

INSERT INTO rms_rate_parity_issues (channel, room_type, our_rate, channel_rate, diff_percent, status, active) VALUES
  ('Expedia', 'Deluxe Suite', 165, 155, -10, 'violation', true),
  ('Booking.com', 'Standard Room', 100, 105, 5, 'warning', true),
  ('Airbnb', 'Ocean View', 200, 210, 10, 'warning', true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_distribution_rules (channel, room_type, allocation, restriction, active) VALUES
  ('All OTAs', 'Deluxe Suite', 30, 'Min 3 nights', true),
  ('Booking.com', 'Standard Room', 50, 'None', true),
  ('Expedia', 'Family Suite', 20, 'Min 2 nights', false)
ON CONFLICT DO NOTHING;

INSERT INTO rms_sync_schedule (sync_type, frequency, last_run, next_run, active) VALUES
  ('Availability', 'Real-time', '10 min ago', 'Continuous', true),
  ('Rates', 'Hourly', '15 min ago', '45 min', true),
  ('Bookings', 'Every 15 min', '20 min ago', '10 min', true)
ON CONFLICT DO NOTHING;
