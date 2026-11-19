-- Transportation Corporate Contracts & Trips
-- Corporate billing accounts and contract-linked trips.

-- ============================================================================
-- transport_corporate_contracts
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_corporate_contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contract_number TEXT NOT NULL,
  company         TEXT NOT NULL,
  contact         TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  type            TEXT NOT NULL
                    CHECK (type IN ('Executive Transfer', 'Business Meetings', 'Airport Transfers')),
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Active', 'Pending', 'Expired', 'Cancelled')),
  start_date      DATE,
  end_date        DATE,
  monthly_volume  INTEGER NOT NULL DEFAULT 0 CHECK (monthly_volume >= 0),
  rate_type       TEXT NOT NULL DEFAULT 'Fixed Rate'
                    CHECK (rate_type IN ('Fixed Rate', 'Distance-Based', 'Time-Based', 'Package Rate')),
  standard_rate   NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (standard_rate >= 0),
  billing_cycle   TEXT NOT NULL DEFAULT 'Monthly'
                    CHECK (billing_cycle IN ('Monthly', 'Weekly', 'Per Trip')),
  credit_limit    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, contract_number)
);

CREATE INDEX IF NOT EXISTS idx_corporate_contracts_property ON transport_corporate_contracts(property_id);
CREATE INDEX IF NOT EXISTS idx_corporate_contracts_status   ON transport_corporate_contracts(property_id, status);

-- ============================================================================
-- transport_corporate_trips
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_corporate_trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  trip_number      TEXT NOT NULL,
  contract_id      UUID REFERENCES transport_corporate_contracts(id) ON DELETE SET NULL,
  company          TEXT,
  guest_name       TEXT NOT NULL,
  type             TEXT,
  pickup           TEXT NOT NULL,
  destination      TEXT NOT NULL,
  scheduled_time   TIMESTAMPTZ NOT NULL,
  assigned_vehicle TEXT,
  driver_id        UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  passenger_count  INTEGER NOT NULL DEFAULT 1 CHECK (passenger_count >= 1),
  status           TEXT NOT NULL DEFAULT 'Confirmed'
                     CHECK (status IN ('Requested', 'Confirmed', 'In Progress', 'Completed', 'Cancelled')),
  amount           NUMERIC(10, 2) CHECK (amount IS NULL OR amount >= 0),
  billed_to        TEXT DEFAULT 'Corporate Account',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, trip_number)
);

CREATE INDEX IF NOT EXISTS idx_corporate_trips_property  ON transport_corporate_trips(property_id);
CREATE INDEX IF NOT EXISTS idx_corporate_trips_contract  ON transport_corporate_trips(contract_id);
CREATE INDEX IF NOT EXISTS idx_corporate_trips_status    ON transport_corporate_trips(property_id, status);
CREATE INDEX IF NOT EXISTS idx_corporate_trips_scheduled ON transport_corporate_trips(property_id, scheduled_time);

-- ============================================================================
-- Triggers / Grants / RLS
-- ============================================================================
DROP TRIGGER IF EXISTS transport_corporate_contracts_updated_at ON transport_corporate_contracts;
CREATE TRIGGER transport_corporate_contracts_updated_at
  BEFORE UPDATE ON transport_corporate_contracts
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS transport_corporate_trips_updated_at ON transport_corporate_trips;
CREATE TRIGGER transport_corporate_trips_updated_at
  BEFORE UPDATE ON transport_corporate_trips
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_corporate_contracts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_corporate_trips TO authenticated;

ALTER TABLE transport_corporate_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_corporate_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_corporate_contracts_read ON transport_corporate_contracts;
CREATE POLICY transport_corporate_contracts_read ON transport_corporate_contracts
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS transport_corporate_contracts_write ON transport_corporate_contracts;
CREATE POLICY transport_corporate_contracts_write ON transport_corporate_contracts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS transport_corporate_trips_read ON transport_corporate_trips;
CREATE POLICY transport_corporate_trips_read ON transport_corporate_trips
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS transport_corporate_trips_write ON transport_corporate_trips;
CREATE POLICY transport_corporate_trips_write ON transport_corporate_trips
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  c1 UUID; c2 UUID; c3 UUID;
  v_d_vh003 UUID; v_d_vh012 UUID; v_d_any UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_corporate_contracts WHERE property_id = v_main) THEN
    INSERT INTO transport_corporate_contracts
      (property_id, contract_number, company, contact, email, phone, type, status,
       start_date, end_date, monthly_volume, rate_type, standard_rate, billing_cycle, credit_limit, current_balance)
    VALUES
      (v_main, 'CC-001', 'Acme Corporation', 'John Smith', 'john.smith@acme.com', '+1 555-0101',
       'Executive Transfer', 'Active', '2026-01-01', '2026-12-31', 50, 'Fixed Rate', 85.00, 'Monthly', 10000.00, 2450.00),
      (v_main, 'CC-002', 'Tech Solutions Inc', 'Sarah Johnson', 'sarah.j@techsolutions.com', '+1 555-0102',
       'Business Meetings', 'Active', '2026-03-01', '2026-12-31', 30, 'Distance-Based', 2.50, 'Monthly', 5000.00, 1250.00),
      (v_main, 'CC-003', 'Global Partners LLC', 'Michael Brown', 'm.brown@globalpartners.com', '+1 555-0103',
       'Airport Transfers', 'Active', '2026-02-15', '2026-12-31', 75, 'Package Rate', 65.00, 'Monthly', 15000.00, 3875.00),
      (v_main, 'CC-004', 'StartUp Ventures', 'Emily Davis', 'emily@startupventures.com', '+1 555-0104',
       'Executive Transfer', 'Pending', '2026-08-01', '2026-12-31', 20, 'Fixed Rate', 75.00, 'Monthly', 3000.00, 0.00);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM transport_corporate_trips WHERE property_id = v_main) THEN
    SELECT id INTO c1 FROM transport_corporate_contracts WHERE property_id = v_main AND contract_number = 'CC-001';
    SELECT id INTO c2 FROM transport_corporate_contracts WHERE property_id = v_main AND contract_number = 'CC-002';
    SELECT id INTO c3 FROM transport_corporate_contracts WHERE property_id = v_main AND contract_number = 'CC-003';
    SELECT id INTO v_d_vh003 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-003' LIMIT 1;
    SELECT id INTO v_d_vh012 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-012' LIMIT 1;
    SELECT id INTO v_d_any FROM transport_drivers WHERE property_id = v_main AND status = 'Active' AND id IS DISTINCT FROM v_d_vh003 AND id IS DISTINCT FROM v_d_vh012 LIMIT 1;

    INSERT INTO transport_corporate_trips
      (property_id, trip_number, contract_id, company, guest_name, type, pickup, destination,
       scheduled_time, assigned_vehicle, driver_id, passenger_count, status, amount, billed_to)
    VALUES
      (v_main, 'CT-001', c1, 'Acme Corporation', 'Executive Team', 'Executive Transfer',
       'Hotel VIP Entrance', 'Wall Street', '2026-07-30 15:00:00+00', 'VH-012', v_d_vh012, 3, 'Confirmed', 85.00, 'Corporate Account'),
      (v_main, 'CT-002', c2, 'Tech Solutions Inc', 'Development Team', 'Business Meeting',
       'Hotel Main Entrance', 'Silicon Alley', '2026-07-30 16:30:00+00', 'VH-008', v_d_any, 5, 'In Progress', 45.00, 'Corporate Account'),
      (v_main, 'CT-003', c3, 'Global Partners LLC', 'VIP Client', 'Airport Transfer',
       'JFK Airport - Terminal 4', 'Hotel VIP Entrance', '2026-07-30 14:00:00+00', 'VH-003', v_d_vh003, 1, 'Completed', 65.00, 'Corporate Account');
  END IF;
END $$;
