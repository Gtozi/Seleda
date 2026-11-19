-- Transportation Guest Transports
-- Guest-facing local transfers (restaurant, tour, medical, special assistance).
-- Links to shared guests and transport_drivers.

-- ============================================================================
-- transport_guest_transports
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_guest_transports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  transport_number   TEXT NOT NULL,
  guest_id           TEXT REFERENCES guests(id) ON DELETE SET NULL,
  guest_name         TEXT NOT NULL,
  room               TEXT,
  type               TEXT NOT NULL
                       CHECK (type IN ('Local Transfer', 'Restaurant Transfer', 'Tour Transportation', 'Medical Transportation', 'Special Assistance')),
  subtype            TEXT,
  pickup             TEXT NOT NULL,
  destination        TEXT NOT NULL,
  scheduled_time     TIMESTAMPTZ NOT NULL,
  assigned_vehicle   TEXT,
  driver_id          UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  passenger_count    INTEGER NOT NULL DEFAULT 1 CHECK (passenger_count >= 1),
  status             TEXT NOT NULL DEFAULT 'Requested'
                       CHECK (status IN ('Requested', 'Pending', 'Confirmed', 'In Progress', 'Completed', 'Cancelled')),
  special_requests   TEXT,
  estimated_duration TEXT,
  amount             NUMERIC(10, 2) CHECK (amount IS NULL OR amount >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, transport_number)
);

CREATE INDEX IF NOT EXISTS idx_guest_transports_property  ON transport_guest_transports(property_id);
CREATE INDEX IF NOT EXISTS idx_guest_transports_status    ON transport_guest_transports(property_id, status);
CREATE INDEX IF NOT EXISTS idx_guest_transports_scheduled ON transport_guest_transports(property_id, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_guest_transports_guest     ON transport_guest_transports(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_transports_driver    ON transport_guest_transports(driver_id);

-- ============================================================================
-- Triggers / Grants / RLS
-- ============================================================================
DROP TRIGGER IF EXISTS transport_guest_transports_updated_at ON transport_guest_transports;
CREATE TRIGGER transport_guest_transports_updated_at
  BEFORE UPDATE ON transport_guest_transports
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_guest_transports TO authenticated;

ALTER TABLE transport_guest_transports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_guest_transports_read ON transport_guest_transports;
CREATE POLICY transport_guest_transports_read ON transport_guest_transports
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_guest_transports_write ON transport_guest_transports;
CREATE POLICY transport_guest_transports_write ON transport_guest_transports
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_d_vh001 UUID; v_d_vh002 UUID; v_d_vh004 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_guest_transports WHERE property_id = v_main) THEN
    SELECT id INTO v_d_vh001 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-001' LIMIT 1;
    SELECT id INTO v_d_vh002 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-002' LIMIT 1;
    SELECT id INTO v_d_vh004 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-004' LIMIT 1;

    INSERT INTO transport_guest_transports
      (property_id, transport_number, guest_id, guest_name, room, type, subtype,
       pickup, destination, scheduled_time, assigned_vehicle, driver_id,
       passenger_count, status, special_requests, estimated_duration, amount)
    VALUES
      (v_main, 'GT-001',
        (SELECT id FROM guests WHERE name ILIKE 'John Smith' LIMIT 1),
        'John Smith', '302', 'Local Transfer', 'Shopping Trip',
        'Hotel Lobby', 'Fifth Avenue Shopping District', '2026-07-30 15:00:00+00',
        'VH-001', v_d_vh001, 2, 'Confirmed', 'Multiple shopping stops', '3 hours', 45.00),
      (v_main, 'GT-002',
        (SELECT id FROM guests WHERE name ILIKE 'Sarah Johnson' LIMIT 1),
        'Sarah Johnson', '415', 'Restaurant Transfer', 'Dinner Reservation',
        'Hotel Lobby', 'Le Bernardin Restaurant', '2026-07-30 19:30:00+00',
        NULL, NULL, 4, 'Pending', 'Celebration dinner', '2 hours', 35.00),
      (v_main, 'GT-003',
        (SELECT id FROM guests WHERE name ILIKE 'Michael Brown' LIMIT 1),
        'Michael Brown', '512', 'Tour Transportation', 'City Sightseeing',
        'Hotel Lobby', 'Multiple Tourist Attractions', '2026-07-31 09:00:00+00',
        'VH-004', v_d_vh004, 3, 'Confirmed', 'Wheelchair accessible', '6 hours', 180.00),
      (v_main, 'GT-004',
        (SELECT id FROM guests WHERE name ILIKE 'Emily Davis' LIMIT 1),
        'Emily Davis', '228', 'Medical Transportation', 'Hospital Visit',
        'Hotel Lobby', 'Mount Sinai Hospital', '2026-07-30 14:00:00+00',
        'VH-002', v_d_vh002, 1, 'In Progress', 'Patient needs assistance', '1 hour', 40.00),
      (v_main, 'GT-005',
        (SELECT id FROM guests WHERE name ILIKE 'Robert Wilson' LIMIT 1),
        'Robert Wilson', '318', 'Special Assistance', 'Accessibility Service',
        'Hotel Lobby', 'Broadway Theater', '2026-07-30 20:00:00+00',
        NULL, NULL, 2, 'Requested', 'Wheelchair accessible vehicle', '3 hours', 55.00);
  END IF;
END $$;
