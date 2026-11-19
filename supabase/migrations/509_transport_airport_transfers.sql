-- Transportation Airport Transfers
-- Flight-tracked airport pickups/drop-offs. Optionally links to shared guests
-- and transport_drivers for assignment.

-- ============================================================================
-- transport_airport_transfers
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_airport_transfers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  transfer_number   TEXT NOT NULL,
  guest_id          TEXT REFERENCES guests(id) ON DELETE SET NULL,
  guest_name        TEXT NOT NULL,
  room              TEXT,
  type              TEXT NOT NULL
                      CHECK (type IN ('Arrival Pickup', 'Departure Drop-off', 'Meet & Greet', 'VIP Pickup', 'Group Transfer', 'Executive Transfer')),
  service           TEXT NOT NULL DEFAULT 'Standard'
                      CHECK (service IN ('Standard', 'VIP Meet & Greet', 'Group', 'Executive')),
  flight_number     TEXT NOT NULL,
  airline           TEXT,
  terminal          TEXT,
  scheduled_time    TIMESTAMPTZ NOT NULL,
  estimated_landing TIMESTAMPTZ,
  actual_landing    TIMESTAMPTZ,
  flight_status     TEXT NOT NULL DEFAULT 'Scheduled'
                      CHECK (flight_status IN ('Scheduled', 'In Flight', 'Landed', 'Delayed', 'Cancelled', 'Diverted')),
  delay             TEXT,
  pickup_location   TEXT NOT NULL,
  destination       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Requested'
                      CHECK (status IN ('Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show')),
  meet_greet        BOOLEAN NOT NULL DEFAULT FALSE,
  passenger_count   INTEGER NOT NULL DEFAULT 1 CHECK (passenger_count >= 1),
  luggage_count     INTEGER NOT NULL DEFAULT 0 CHECK (luggage_count >= 0),
  assigned_vehicle  TEXT,
  driver_id         UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, transfer_number)
);

CREATE INDEX IF NOT EXISTS idx_airport_transfers_property  ON transport_airport_transfers(property_id);
CREATE INDEX IF NOT EXISTS idx_airport_transfers_status    ON transport_airport_transfers(property_id, status);
CREATE INDEX IF NOT EXISTS idx_airport_transfers_scheduled ON transport_airport_transfers(property_id, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_airport_transfers_guest     ON transport_airport_transfers(guest_id);
CREATE INDEX IF NOT EXISTS idx_airport_transfers_driver    ON transport_airport_transfers(driver_id);
CREATE INDEX IF NOT EXISTS idx_airport_transfers_flight    ON transport_airport_transfers(property_id, flight_number);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS transport_airport_transfers_updated_at ON transport_airport_transfers;
CREATE TRIGGER transport_airport_transfers_updated_at
  BEFORE UPDATE ON transport_airport_transfers
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_airport_transfers TO authenticated;

ALTER TABLE transport_airport_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_airport_transfers_read ON transport_airport_transfers;
CREATE POLICY transport_airport_transfers_read ON transport_airport_transfers
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_airport_transfers_write ON transport_airport_transfers;
CREATE POLICY transport_airport_transfers_write ON transport_airport_transfers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_d_vh003 UUID; v_d_vh012 UUID; v_d_vh001 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_airport_transfers WHERE property_id = v_main) THEN
    SELECT id INTO v_d_vh003 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-003' LIMIT 1;
    SELECT id INTO v_d_vh012 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-012' LIMIT 1;
    SELECT id INTO v_d_vh001 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-001' LIMIT 1;

    INSERT INTO transport_airport_transfers
      (property_id, transfer_number, guest_id, guest_name, room, type, service, flight_number, airline, terminal,
       scheduled_time, estimated_landing, actual_landing, flight_status, delay, pickup_location, destination,
       status, meet_greet, passenger_count, luggage_count, assigned_vehicle, driver_id)
    VALUES
      (v_main, 'AT-001',
        (SELECT id FROM guests WHERE name ILIKE 'John Smith' LIMIT 1),
        'John Smith', '302', 'Arrival Pickup', 'Standard', 'BA247', 'British Airways', 'Terminal 4',
        '2026-07-30 14:30:00+00', '2026-07-30 14:15:00+00', '2026-07-30 14:22:00+00', 'Landed', '+7 min',
        'JFK Airport - Terminal 4, Arrivals', 'Hotel Main Entrance',
        'Driver En Route', FALSE, 2, 3, 'VH-003', v_d_vh003),
      (v_main, 'AT-002',
        (SELECT id FROM guests WHERE name ILIKE 'Sarah Johnson' LIMIT 1),
        'Sarah Johnson', '415', 'Departure Drop-off', 'Standard', 'DL892', 'Delta Airlines', 'Terminal 3',
        '2026-07-30 19:30:00+00', NULL, NULL, 'Scheduled', NULL,
        'Hotel Lobby', 'LGA Airport - Terminal 3',
        'Confirmed', FALSE, 1, 2, NULL, NULL),
      (v_main, 'AT-003',
        NULL,
        'VIP Guest', 'Penthouse', 'VIP Pickup', 'VIP Meet & Greet', 'LH456', 'Lufthansa', 'Terminal 1',
        '2026-07-31 06:00:00+00', '2026-07-31 05:45:00+00', NULL, 'In Flight', NULL,
        'JFK Airport - Terminal 1, VIP Lounge', 'Hotel VIP Entrance',
        'Confirmed', TRUE, 3, 5, 'VH-012', v_d_vh012),
      (v_main, 'AT-004',
        NULL,
        'Conference Group', NULL, 'Group Transfer', 'Group', 'UA789', 'United Airlines', 'Terminal 7',
        '2026-07-31 10:00:00+00', '2026-07-31 09:45:00+00', NULL, 'Scheduled', NULL,
        'JFK Airport - Terminal 7, Bus Bay', 'Hotel Main Entrance',
        'Requested', TRUE, 20, 15, NULL, NULL),
      (v_main, 'AT-005',
        (SELECT id FROM guests WHERE name ILIKE 'Michael Brown' LIMIT 1),
        'Michael Brown', '512', 'Arrival Pickup', 'Standard', 'AF123', 'Air France', 'Terminal 2',
        '2026-07-30 16:00:00+00', '2026-07-30 15:30:00+00', '2026-07-30 17:45:00+00', 'Landed', '+2h 15min',
        'JFK Airport - Terminal 2, Arrivals', 'Hotel Main Entrance',
        'Completed', FALSE, 1, 2, 'VH-001', v_d_vh001);
  END IF;
END $$;
