-- Transport portal gap fixes (round 2)
--   1. transport_pricing_rules — zone/distance/time/package pricing (spec §22)
--   2. transport_maintenance_requests.work_order_id — Engineering WO link (§20)
--   3. transport_fuel_purchases.flagged/flag_reason — theft/anomaly flag (§19)
--   4. transport_airport_transfers.last_flight_check — flight API polling (§8)
--   5. transport_vehicles.tank_capacity_gal — for fuel anomaly checks

-- ============================================================================
-- 1. Pricing rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_pricing_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  transport_type TEXT,                 -- NULL = applies to all types
  rule_type     TEXT NOT NULL DEFAULT 'Fixed'
                  CHECK (rule_type IN ('Fixed', 'Distance-Based', 'Time-Based', 'Zone-Based', 'Package')),
  base_fare     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
  per_km_rate   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (per_km_rate >= 0),
  per_minute_rate NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (per_minute_rate >= 0),
  zone_from     TEXT,
  zone_to       TEXT,
  package_price NUMERIC(10,2) CHECK (package_price IS NULL OR package_price >= 0),
  min_fare      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_fare >= 0),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  priority      INTEGER NOT NULL DEFAULT 0,    -- higher wins when rules overlap
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_property ON transport_pricing_rules(property_id, active, priority DESC);

DROP TRIGGER IF EXISTS transport_pricing_rules_updated_at ON transport_pricing_rules;
CREATE TRIGGER transport_pricing_rules_updated_at
  BEFORE UPDATE ON transport_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_pricing_rules TO authenticated;

ALTER TABLE transport_pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_pricing_rules_read ON transport_pricing_rules;
CREATE POLICY transport_pricing_rules_read ON transport_pricing_rules
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_pricing_rules_write ON transport_pricing_rules;
CREATE POLICY transport_pricing_rules_write ON transport_pricing_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- 2. Maintenance → Engineering work order link
-- ============================================================================
ALTER TABLE transport_maintenance_requests
  ADD COLUMN IF NOT EXISTS work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tmr_work_order ON transport_maintenance_requests(work_order_id);

-- ============================================================================
-- 3. Fuel anomaly flags (theft/fraud detection)
-- ============================================================================
ALTER TABLE transport_fuel_purchases
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_fuel_purch_flagged ON transport_fuel_purchases(property_id, flagged) WHERE flagged;

-- ============================================================================
-- 4. Flight tracking bookkeeping
-- ============================================================================
ALTER TABLE transport_airport_transfers
  ADD COLUMN IF NOT EXISTS last_flight_check TIMESTAMPTZ;

-- ============================================================================
-- 5. Vehicle tank capacity for fuel anomaly checks
-- ============================================================================
ALTER TABLE transport_vehicles
  ADD COLUMN IF NOT EXISTS tank_capacity_gal NUMERIC(6,2) CHECK (tank_capacity_gal IS NULL OR tank_capacity_gal > 0);
