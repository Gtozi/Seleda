-- 516_transport_fuel.sql
-- Fuel cards + fuel purchases for the Fuel Management page.

CREATE TABLE IF NOT EXISTS transport_fuel_cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  card_number      TEXT NOT NULL,
  masked_number    TEXT,
  type             TEXT NOT NULL DEFAULT 'Shell',
  status           TEXT NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Blocked', 'Expired', 'Lost')),
  credit_limit     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  balance          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  assigned_vehicle TEXT,
  expiry_date      DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, card_number)
);

CREATE TABLE IF NOT EXISTS transport_fuel_purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  purchase_number  TEXT NOT NULL,
  purchase_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id       UUID REFERENCES transport_vehicles(id) ON DELETE SET NULL,
  driver_id        UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  station          TEXT,
  fuel_type        TEXT NOT NULL DEFAULT 'Gasoline'
                     CHECK (fuel_type IN ('Gasoline', 'Diesel', 'Electric', 'Hybrid')),
  gallons          NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (gallons >= 0),
  price_per_gallon NUMERIC(8,3) NOT NULL DEFAULT 0 CHECK (price_per_gallon >= 0),
  total_cost       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  odometer         INTEGER CHECK (odometer IS NULL OR odometer >= 0),
  fuel_card_id     UUID REFERENCES transport_fuel_cards(id) ON DELETE SET NULL,
  efficiency       NUMERIC(6,2) CHECK (efficiency IS NULL OR efficiency >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, purchase_number)
);

CREATE INDEX IF NOT EXISTS idx_fuel_cards_property     ON transport_fuel_cards(property_id);
CREATE INDEX IF NOT EXISTS idx_fuel_purch_property     ON transport_fuel_purchases(property_id);
CREATE INDEX IF NOT EXISTS idx_fuel_purch_date         ON transport_fuel_purchases(property_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_purch_vehicle      ON transport_fuel_purchases(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_purch_card         ON transport_fuel_purchases(fuel_card_id);

DROP TRIGGER IF EXISTS transport_fuel_cards_updated_at ON transport_fuel_cards;
CREATE TRIGGER transport_fuel_cards_updated_at
  BEFORE UPDATE ON transport_fuel_cards
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS transport_fuel_purchases_updated_at ON transport_fuel_purchases;
CREATE TRIGGER transport_fuel_purchases_updated_at
  BEFORE UPDATE ON transport_fuel_purchases
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_fuel_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_fuel_purchases TO authenticated;

ALTER TABLE transport_fuel_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_fuel_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_fuel_cards_read ON transport_fuel_cards;
CREATE POLICY transport_fuel_cards_read ON transport_fuel_cards
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS transport_fuel_cards_write ON transport_fuel_cards;
CREATE POLICY transport_fuel_cards_write ON transport_fuel_cards
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS transport_fuel_purchases_read ON transport_fuel_purchases;
CREATE POLICY transport_fuel_purchases_read ON transport_fuel_purchases
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS transport_fuel_purchases_write ON transport_fuel_purchases;
CREATE POLICY transport_fuel_purchases_write ON transport_fuel_purchases
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's cards + purchases for GH-MAIN ──────────────────────────
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  c1 UUID; c2 UUID; c3 UUID; c4 UUID;
  vh003 UUID; vh001 UUID; vh006 UUID; vh004 UUID; vh002 UUID;
  d_of UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_fuel_cards WHERE property_id = v_main) THEN
    INSERT INTO transport_fuel_cards (property_id, card_number, masked_number, type, status, credit_limit, balance, expiry_date)
    VALUES
      (v_main, 'FC-001', '****1234', 'Shell',  'Active',  500.00, 440.32, CURRENT_DATE + interval '18 months'),
      (v_main, 'FC-002', '****5678', 'BP',     'Active',  300.00, 251.78, CURRENT_DATE + interval '14 months'),
      (v_main, 'FC-003', '****9012', 'Tesla',  'Active',  200.00, 172.00, CURRENT_DATE + interval '22 months'),
      (v_main, 'FC-004', '****3456', 'Exxon',  'Blocked', 400.00, 296.25, CURRENT_DATE + interval '9 months');
    SELECT id INTO c1 FROM transport_fuel_cards WHERE property_id = v_main AND card_number = 'FC-001';
    SELECT id INTO c2 FROM transport_fuel_cards WHERE property_id = v_main AND card_number = 'FC-002';
    SELECT id INTO c3 FROM transport_fuel_cards WHERE property_id = v_main AND card_number = 'FC-003';
    SELECT id INTO c4 FROM transport_fuel_cards WHERE property_id = v_main AND card_number = 'FC-004';

    SELECT id INTO vh003 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-003';
    SELECT id INTO vh001 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-001';
    SELECT id INTO vh006 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-006';
    SELECT id INTO vh004 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-004';
    SELECT id INTO vh002 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-002';

    SELECT driver_id INTO d_of FROM transport_vehicles WHERE id = vh003;
    INSERT INTO transport_fuel_purchases
      (property_id, purchase_number, purchase_date, vehicle_id, driver_id, station, fuel_type, gallons, price_per_gallon, total_cost, odometer, fuel_card_id, efficiency)
    VALUES
      (v_main, 'FL-001', CURRENT_DATE, vh003, d_of, 'Shell - Downtown', 'Gasoline', 15.5, 3.85, 59.68, 45280, c1, 28.5);
    SELECT driver_id INTO d_of FROM transport_vehicles WHERE id = vh001;
    INSERT INTO transport_fuel_purchases
      (property_id, purchase_number, purchase_date, vehicle_id, driver_id, station, fuel_type, gallons, price_per_gallon, total_cost, odometer, fuel_card_id, efficiency)
    VALUES
      (v_main, 'FL-002', CURRENT_DATE - 1, vh001, d_of, 'BP - Midtown', 'Gasoline', 12.3, 3.92, 48.22, 45150, c2, 32.1);
    SELECT driver_id INTO d_of FROM transport_vehicles WHERE id = vh006;
    INSERT INTO transport_fuel_purchases
      (property_id, purchase_number, purchase_date, vehicle_id, driver_id, station, fuel_type, gallons, price_per_gallon, total_cost, odometer, fuel_card_id, efficiency)
    VALUES
      (v_main, 'FL-003', CURRENT_DATE - 1, vh006, d_of, 'Tesla Supercharger', 'Electric', 0, 0.35, 28.00, 28720, c3, 4.2);
    SELECT driver_id INTO d_of FROM transport_vehicles WHERE id = vh004;
    INSERT INTO transport_fuel_purchases
      (property_id, purchase_number, purchase_date, vehicle_id, driver_id, station, fuel_type, gallons, price_per_gallon, total_cost, odometer, fuel_card_id, efficiency)
    VALUES
      (v_main, 'FL-004', CURRENT_DATE - 2, vh004, d_of, 'Exxon - Highway', 'Diesel', 25.0, 4.15, 103.75, 89500, c4, 18.3);
    SELECT driver_id INTO d_of FROM transport_vehicles WHERE id = vh002;
    INSERT INTO transport_fuel_purchases
      (property_id, purchase_number, purchase_date, vehicle_id, driver_id, station, fuel_type, gallons, price_per_gallon, total_cost, odometer, fuel_card_id, efficiency)
    VALUES
      (v_main, 'FL-005', CURRENT_DATE - 2, vh002, d_of, 'Shell - Airport', 'Gasoline', 18.2, 3.98, 72.44, 67800, c1, 24.7);
  END IF;
END $$;
