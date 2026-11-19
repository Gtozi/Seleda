-- 518_transport_contractors.sql
-- External contractors + their trips for the Contractor & Taxi Management page.

CREATE TABLE IF NOT EXISTS transport_contractors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contractor_number TEXT NOT NULL,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'Taxi Company'
                      CHECK (type IN ('Taxi Company', 'Chauffeur Service', 'Bus Operator', 'Tour Operator')),
  contact           TEXT,
  phone             TEXT,
  email             TEXT,
  status            TEXT NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Active', 'Pending', 'Inactive')),
  contract_start    DATE,
  contract_end      DATE,
  rate_structure    TEXT NOT NULL DEFAULT 'Per Trip'
                      CHECK (rate_structure IN ('Per Mile', 'Hourly', 'Per Trip', 'Package')),
  base_rate         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (base_rate >= 0),
  per_mile_rate     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (per_mile_rate >= 0),
  performance       NUMERIC(3,1) NOT NULL DEFAULT 0 CHECK (performance >= 0 AND performance <= 5),
  total_trips       INTEGER NOT NULL DEFAULT 0 CHECK (total_trips >= 0),
  on_time_rate      INTEGER NOT NULL DEFAULT 0 CHECK (on_time_rate >= 0 AND on_time_rate <= 100),
  rating            NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, contractor_number)
);

CREATE TABLE IF NOT EXISTS transport_contractor_trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  trip_number      TEXT NOT NULL,
  contractor_id    UUID REFERENCES transport_contractors(id) ON DELETE SET NULL,
  trip_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  destination      TEXT,
  amount           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status           TEXT NOT NULL DEFAULT 'Scheduled'
                     CHECK (status IN ('Scheduled', 'In Progress', 'Completed', 'Cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, trip_number)
);

CREATE INDEX IF NOT EXISTS idx_contractors_property ON transport_contractors(property_id);
CREATE INDEX IF NOT EXISTS idx_contractors_status   ON transport_contractors(property_id, status);
CREATE INDEX IF NOT EXISTS idx_ctr_trips_property   ON transport_contractor_trips(property_id);
CREATE INDEX IF NOT EXISTS idx_ctr_trips_contractor ON transport_contractor_trips(contractor_id);
CREATE INDEX IF NOT EXISTS idx_ctr_trips_date       ON transport_contractor_trips(property_id, trip_date DESC);

DROP TRIGGER IF EXISTS transport_contractors_updated_at ON transport_contractors;
CREATE TRIGGER transport_contractors_updated_at
  BEFORE UPDATE ON transport_contractors
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS transport_contractor_trips_updated_at ON transport_contractor_trips;
CREATE TRIGGER transport_contractor_trips_updated_at
  BEFORE UPDATE ON transport_contractor_trips
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_contractors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_contractor_trips TO authenticated;

ALTER TABLE transport_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_contractor_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_contractors_read ON transport_contractors;
CREATE POLICY transport_contractors_read ON transport_contractors
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS transport_contractors_write ON transport_contractors;
CREATE POLICY transport_contractors_write ON transport_contractors
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS transport_contractor_trips_read ON transport_contractor_trips;
CREATE POLICY transport_contractor_trips_read ON transport_contractor_trips
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS transport_contractor_trips_write ON transport_contractor_trips;
CREATE POLICY transport_contractor_trips_write ON transport_contractor_trips
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's contractors + trips for GH-MAIN ────────────────────────
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  ctr1 UUID; ctr2 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_contractors WHERE property_id = v_main) THEN
    INSERT INTO transport_contractors
      (property_id, contractor_number, name, type, contact, phone, email, status,
       contract_start, contract_end, rate_structure, base_rate, per_mile_rate,
       performance, total_trips, on_time_rate, rating)
    VALUES
      (v_main, 'CTR-001', 'City Cab Co', 'Taxi Company', 'John Smith', '+1 555-0101', 'john@citycab.com', 'Active',
       CURRENT_DATE - interval '8 months', CURRENT_DATE + interval '4 months', 'Per Mile', 3.50, 2.75, 4.5, 1250, 92, 4.2),
      (v_main, 'CTR-002', 'Elite Chauffeur Services', 'Chauffeur Service', 'Sarah Johnson', '+1 555-0102', 'sarah@elitechauffeur.com', 'Active',
       CURRENT_DATE - interval '6 months', CURRENT_DATE + interval '4 months', 'Hourly', 85.00, 0, 4.8, 380, 98, 4.7),
      (v_main, 'CTR-003', 'Metro Bus Lines', 'Bus Operator', 'Michael Brown', '+1 555-0103', 'michael@metrobus.com', 'Active',
       CURRENT_DATE - interval '7 months', CURRENT_DATE + interval '4 months', 'Per Trip', 250.00, 0, 4.3, 85, 95, 4.1),
      (v_main, 'CTR-004', 'Tour Operators Inc', 'Tour Operator', 'Emily Davis', '+1 555-0104', 'emily@tourop.com', 'Pending',
       CURRENT_DATE + interval '2 weeks', CURRENT_DATE + interval '4 months', 'Package', 180.00, 0, 0, 0, 0, 0);

    SELECT id INTO ctr1 FROM transport_contractors WHERE property_id = v_main AND contractor_number = 'CTR-001';
    SELECT id INTO ctr2 FROM transport_contractors WHERE property_id = v_main AND contractor_number = 'CTR-002';

    INSERT INTO transport_contractor_trips
      (property_id, trip_number, contractor_id, trip_date, destination, amount, status)
    VALUES
      (v_main, 'CT-001', ctr1, CURRENT_DATE, 'Times Square', 25.00, 'Completed'),
      (v_main, 'CT-002', ctr2, CURRENT_DATE, 'Private Airport', 170.00, 'Completed'),
      (v_main, 'CT-003', ctr1, CURRENT_DATE - 1, 'JFK Airport', 45.00, 'Completed');
  END IF;
END $$;
