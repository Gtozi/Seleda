-- RMS Promotions Analysis module.
-- Replaces hardcoded mock promotions and coupon performance in PromotionsAnalysis.tsx.

CREATE TABLE IF NOT EXISTS rms_promotions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID REFERENCES properties(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  code                TEXT NOT NULL,
  promo_type          TEXT NOT NULL DEFAULT 'discount', -- 'discount','flash','loyalty','group'
  discount            NUMERIC(5,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active', -- 'active','scheduled','ended'
  start_date          DATE,
  end_date            DATE,
  bookings            INTEGER NOT NULL DEFAULT 0,
  revenue             NUMERIC(14,2) NOT NULL DEFAULT 0,
  incremental_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  roi                 NUMERIC(8,2) NOT NULL DEFAULT 0,
  target_segment      TEXT NOT NULL DEFAULT 'all',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_coupon_performance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  usage_count   INTEGER NOT NULL DEFAULT 0,
  redemptions   INTEGER NOT NULL DEFAULT 0,
  conversion    NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_discount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_promo_status ON rms_promotions(status);
CREATE INDEX IF NOT EXISTS idx_rms_promo_type ON rms_promotions(promo_type);
CREATE INDEX IF NOT EXISTS idx_rms_coupon_code ON rms_coupon_performance(code);

CREATE OR REPLACE FUNCTION public.trg_rms_promotions_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_promo_updated ON rms_promotions;
CREATE TRIGGER trg_rms_promo_updated BEFORE UPDATE ON rms_promotions FOR EACH ROW EXECUTE FUNCTION public.trg_rms_promotions_set_updated_at();
DROP TRIGGER IF EXISTS trg_rms_coupon_updated ON rms_coupon_performance;
CREATE TRIGGER trg_rms_coupon_updated BEFORE UPDATE ON rms_coupon_performance FOR EACH ROW EXECUTE FUNCTION public.trg_rms_promotions_set_updated_at();

ALTER TABLE rms_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_coupon_performance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_promo_read ON rms_promotions;
CREATE POLICY rms_promo_read ON rms_promotions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_promo_write ON rms_promotions;
CREATE POLICY rms_promo_write ON rms_promotions FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_coupon_read ON rms_coupon_performance;
CREATE POLICY rms_coupon_read ON rms_coupon_performance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_coupon_write ON rms_coupon_performance;
CREATE POLICY rms_coupon_write ON rms_coupon_performance FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_promotions (name, code, promo_type, discount, status, start_date, end_date, bookings, revenue, incremental_revenue, roi, target_segment) VALUES
  ('Early Bird Summer', 'EARLY24', 'discount', 15, 'active', '2024-06-01', '2024-08-31', 245, 36750, 8500, 180, 'leisure'),
  ('Corporate Weekend', 'CORPWKND', 'discount', 20, 'active', '2024-11-01', '2024-12-31', 85, 12750, 3200, 145, 'corporate'),
  ('Last Minute Flash Sale', 'FLASH24', 'flash', 25, 'scheduled', '2024-12-20', '2024-12-22', 0, 0, 0, 0, 'all'),
  ('Loyalty Member Bonus', 'LOYALTY25', 'loyalty', 10, 'active', '2024-01-01', '2024-12-31', 180, 24300, 4200, 165, 'loyalty'),
  ('Group Booking Special', 'GROUP10', 'group', 10, 'ended', '2024-09-01', '2024-10-31', 45, 6750, 1500, 120, 'group')
ON CONFLICT DO NOTHING;

INSERT INTO rms_coupon_performance (code, usage_count, redemptions, conversion, avg_discount) VALUES
  ('EARLY24', 245, 198, 81, 22),
  ('CORPWKND', 85, 72, 85, 30),
  ('LOYALTY25', 180, 162, 90, 15)
ON CONFLICT DO NOTHING;
