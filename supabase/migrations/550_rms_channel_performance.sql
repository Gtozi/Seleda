-- RMS Channel Performance module.
-- Replaces hardcoded mock channel data in ChannelPerformance.tsx.

CREATE TABLE IF NOT EXISTS rms_channel_performance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID REFERENCES properties(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  icon_name         TEXT,
  revenue           NUMERIC(14,2) NOT NULL DEFAULT 0,
  adr               NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversion        NUMERIC(6,2) NOT NULL DEFAULT 0,
  acquisition_cost  NUMERIC(6,2) NOT NULL DEFAULT 0,
  cancellation_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  net_revenue       NUMERIC(14,2) NOT NULL DEFAULT 0,
  bookings          INTEGER NOT NULL DEFAULT 0,
  growth            NUMERIC(6,2) NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(property_id, code)
);

CREATE INDEX IF NOT EXISTS idx_rms_channel_perf_code ON rms_channel_performance(code);
CREATE INDEX IF NOT EXISTS idx_rms_channel_perf_net ON rms_channel_performance(net_revenue DESC);

CREATE OR REPLACE FUNCTION public.trg_rms_channel_perf_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_channel_perf_updated ON rms_channel_performance;
CREATE TRIGGER trg_rms_channel_perf_updated
  BEFORE UPDATE ON rms_channel_performance
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_channel_perf_set_updated_at();

ALTER TABLE rms_channel_performance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_channel_perf_read ON rms_channel_performance;
CREATE POLICY rms_channel_perf_read ON rms_channel_performance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_channel_perf_write ON rms_channel_performance;
CREATE POLICY rms_channel_perf_write ON rms_channel_performance FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_channel_performance (code, name, icon_name, revenue, adr, conversion, acquisition_cost, cancellation_rate, net_revenue, bookings, growth, active) VALUES
  ('website', 'Hotel Website', 'Globe', 125000, 155, 4.2, 0, 8, 125000, 245, 15, true),
  ('call_center', 'Call Center', 'Phone', 68000, 145, 12.5, 15, 12, 57800, 120, 8, true),
  ('walk_in', 'Walk-in', 'Users', 35000, 140, 85, 0, 5, 35000, 65, 3, true),
  ('booking', 'Booking.com', 'Globe', 89000, 160, 3.8, 18, 15, 72980, 180, 22, true),
  ('expedia', 'Expedia', 'Globe', 72000, 158, 3.5, 17, 14, 59760, 145, 18, true),
  ('gds', 'GDS', 'Building', 45000, 165, 2.8, 12, 10, 39600, 85, 5, true),
  ('travel_agent', 'Travel Agents', 'Briefcase', 38000, 150, 8.5, 10, 11, 34200, 75, 6, true),
  ('corporate', 'Corporate', 'Building', 98000, 165, 15.2, 5, 7, 93100, 195, 12, true),
  ('wholesale', 'Wholesalers', 'Package', 52000, 115, 6.5, 20, 18, 41600, 110, 9, true)
ON CONFLICT (property_id, code) DO UPDATE SET
  name = EXCLUDED.name, icon_name = EXCLUDED.icon_name, revenue = EXCLUDED.revenue,
  adr = EXCLUDED.adr, conversion = EXCLUDED.conversion, acquisition_cost = EXCLUDED.acquisition_cost,
  cancellation_rate = EXCLUDED.cancellation_rate, net_revenue = EXCLUDED.net_revenue,
  bookings = EXCLUDED.bookings, growth = EXCLUDED.growth, active = EXCLUDED.active;
