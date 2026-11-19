-- Transportation Fleet Vehicles
-- Fleet registry feeding dispatch, vehicle registry and maintenance modules.
-- Optionally links to transport_drivers for the assigned driver.

-- ============================================================================
-- transport_vehicles
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_vehicles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  vehicle_number      TEXT NOT NULL,
  registration_number TEXT,
  vin                 TEXT,
  make                TEXT,
  model               TEXT,
  year                INTEGER,
  color               TEXT,
  category            TEXT NOT NULL DEFAULT 'Sedan'
                        CHECK (category IN ('Sedan', 'SUV', 'Van', 'Minibus', 'Luxury', 'Shuttle Bus', 'Utility Vehicle', 'Motorcycle', 'Electric', 'Electric Vehicle')),
  capacity            INTEGER NOT NULL DEFAULT 4 CHECK (capacity >= 1),
  fuel_type           TEXT NOT NULL DEFAULT 'Gasoline'
                        CHECK (fuel_type IN ('Gasoline', 'Diesel', 'Electric', 'Hybrid')),
  insurance_provider  TEXT,
  insurance_policy    TEXT,
  insurance_expiry    DATE,
  registration_expiry DATE,
  status              TEXT NOT NULL DEFAULT 'Active'
                        CHECK (status IN ('Active', 'In Use', 'Maintenance', 'Out of Service', 'Retired', 'Sold')),
  purchase_date       DATE,
  purchase_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_value       NUMERIC(12,2) NOT NULL DEFAULT 0,
  mileage             NUMERIC(12,1) NOT NULL DEFAULT 0,
  last_service        DATE,
  next_service        DATE,
  driver_id           UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  current_location    TEXT,
  fuel_level          INTEGER NOT NULL DEFAULT 100 CHECK (fuel_level BETWEEN 0 AND 100),
  utilization         INTEGER NOT NULL DEFAULT 0 CHECK (utilization BETWEEN 0 AND 100),
  condition           TEXT NOT NULL DEFAULT 'Good'
                        CHECK (condition IN ('Excellent', 'Good', 'Fair', 'Service Required')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, vehicle_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_vehicles_property ON transport_vehicles(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_vehicles_status   ON transport_vehicles(property_id, status);
CREATE INDEX IF NOT EXISTS idx_transport_vehicles_driver   ON transport_vehicles(driver_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS transport_vehicles_updated_at ON transport_vehicles;
CREATE TRIGGER transport_vehicles_updated_at
  BEFORE UPDATE ON transport_vehicles
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_vehicles TO authenticated;

ALTER TABLE transport_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_vehicles_read ON transport_vehicles;
CREATE POLICY transport_vehicles_read ON transport_vehicles
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_vehicles_write ON transport_vehicles;
CREATE POLICY transport_vehicles_write ON transport_vehicles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo fleet for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_d1 UUID; v_d2 UUID; v_d3 UUID; v_d4 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_vehicles WHERE property_id = v_main) THEN
    -- Match seeded drivers by their assigned_vehicle text from migration 435.
    SELECT id INTO v_d1 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-003' LIMIT 1;
    SELECT id INTO v_d2 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-001' LIMIT 1;
    SELECT id INTO v_d3 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-004' LIMIT 1;
    SELECT id INTO v_d4 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-012' LIMIT 1;

    INSERT INTO transport_vehicles
      (property_id, vehicle_number, registration_number, vin, make, model, year, color, category, capacity, fuel_type,
       insurance_provider, insurance_policy, insurance_expiry, registration_expiry, status,
       purchase_date, purchase_price, current_value, mileage, last_service, next_service,
       driver_id, current_location, fuel_level, utilization, condition)
    VALUES
      (v_main, 'VH-001', 'ABC-1234', '1HGBH41JXMN109186', 'Toyota', 'Camry', 2023, 'Silver', 'Sedan', 4, 'Gasoline',
       'Allstate Insurance', 'POL-123456', '2026-12-31', '2026-11-30', 'Active',
       '2023-01-15', 28000, 24500, 38400, '2026-06-15', '2026-12-15',
       v_d2, 'Hotel Garage', 85, 62, 'Excellent'),
      (v_main, 'VH-002', 'DEF-5678', '2T1BURHE1JC123456', 'Ford', 'Explorer', 2022, 'Black', 'SUV', 7, 'Gasoline',
       'Geico', 'POL-234567', '2026-10-15', '2026-09-30', 'Active',
       '2022-03-20', 42000, 36500, 52100, '2026-05-20', '2026-11-20',
       NULL, 'Hotel Garage', 92, 58, 'Good'),
      (v_main, 'VH-003', 'GHI-9012', '1HGCM82633A123456', 'Honda', 'Accord', 2023, 'White', 'Sedan', 5, 'Hybrid',
       'Allstate Insurance', 'POL-345678', '2027-01-31', '2026-12-15', 'In Use',
       '2023-05-10', 32000, 28500, 41200, '2026-06-01', '2026-12-01',
       v_d1, 'JFK Airport - Terminal 4', 67, 71, 'Good'),
      (v_main, 'VH-004', 'JKL-3456', 'WD0WFDBJ5HA123456', 'Mercedes', 'Sprinter', 2021, 'White', 'Van', 12, 'Diesel',
       'Progressive', 'POL-456789', '2026-08-20', '2026-07-31', 'Active',
       '2021-07-25', 45000, 32000, 78900, '2026-07-01', '2027-01-01',
       v_d3, 'Hotel Garage', 78, 80, 'Fair'),
      (v_main, 'VH-005', 'MNO-7890', 'WBA7402C5LA123456', 'BMW', '7 Series', 2024, 'Black', 'Luxury', 4, 'Gasoline',
       'Chubb', 'POL-567890', '2027-03-15', '2027-02-28', 'Maintenance',
       '2024-01-20', 95000, 88000, 12400, '2026-07-10', '2026-10-10',
       NULL, 'Service Center', 55, 34, 'Service Required'),
      (v_main, 'VH-006', 'PQR-2345', '5YJ3E1EA1JF123456', 'Tesla', 'Model S', 2023, 'Red', 'Electric', 5, 'Electric',
       'Tesla Insurance', 'POL-678901', '2027-06-30', '2027-05-15', 'Active',
       '2023-08-15', 89000, 75000, 23800, '2026-06-20', '2026-12-20',
       NULL, 'Hotel Garage', 96, 45, 'Excellent'),
      (v_main, 'VH-007', 'STU-6789', '1FTBW2CM5GKB12345', 'Ford', 'Transit', 2022, 'Blue', 'Minibus', 15, 'Diesel',
       'Progressive', 'POL-789012', '2026-11-30', '2026-10-31', 'In Use',
       '2022-06-10', 52000, 41000, 64500, '2026-06-25', '2026-12-25',
       NULL, 'Convention Center', 61, 77, 'Good'),
      (v_main, 'VH-008', 'VWX-8901', '3FA6P0H75HR123456', 'Honda', 'CR-V', 2023, 'Gray', 'SUV', 5, 'Gasoline',
       'Geico', 'POL-890123', '2027-04-30', '2027-03-31', 'Active',
       '2023-09-12', 34000, 29800, 28900, '2026-07-05', '2027-01-05',
       NULL, 'Hotel Garage', 45, 52, 'Good'),
      (v_main, 'VH-009', 'YZA-0123', 'WDD5J8JB9LN123456', 'Mercedes', 'S-Class', 2024, 'Black', 'Luxury', 4, 'Gasoline',
       'Chubb', 'POL-901234', '2027-08-31', '2027-07-31', 'Active',
       '2024-03-05', 110000, 98500, 8900, '2026-07-15', '2027-01-15',
       NULL, 'Hotel Garage', 88, 29, 'Excellent'),
      (v_main, 'VH-012', 'BCD-4567', '1C4RJFBG5MC123456', 'Jeep', 'Grand Cherokee', 2023, 'Black', 'SUV', 5, 'Gasoline',
       'Allstate Insurance', 'POL-012345', '2026-12-31', '2026-11-30', 'In Use',
       '2023-02-18', 48000, 40500, 33200, '2026-06-10', '2026-12-10',
       v_d4, 'Private Airport', 73, 66, 'Good');
  END IF;
END $$;
