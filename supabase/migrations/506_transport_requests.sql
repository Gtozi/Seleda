-- Transportation Requests
-- Guest/staff transport requests feeding dispatch. Optionally links to the
-- shared guests table and transport_drivers for assignment.

-- ============================================================================
-- transport_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  request_number      TEXT NOT NULL,
  guest_id            TEXT REFERENCES guests(id) ON DELETE SET NULL,
  guest_name          TEXT NOT NULL,
  room                TEXT,
  type                TEXT NOT NULL
                        CHECK (type IN ('Airport Pickup', 'Airport Drop-off', 'City Transfer', 'Hotel Shuttle', 'Sightseeing Tour', 'VIP Transport', 'Staff Shuttle', 'Courier Service')),
  source              TEXT NOT NULL DEFAULT 'Front Office'
                        CHECK (source IN ('Front Office', 'Concierge', 'Guest Mobile App', 'Website', 'Reservation System', 'Corporate Account', 'Events & Banquets', 'Staff Portal')),
  pickup_location     TEXT NOT NULL,
  destination         TEXT NOT NULL,
  scheduled_time      TIMESTAMPTZ NOT NULL,
  passenger_count     INTEGER NOT NULL DEFAULT 1 CHECK (passenger_count >= 1),
  luggage_count       INTEGER NOT NULL DEFAULT 0 CHECK (luggage_count >= 0),
  status              TEXT NOT NULL DEFAULT 'Requested'
                        CHECK (status IN ('Requested', 'Confirmed', 'Assigned', 'Driver En Route', 'Guest Picked Up', 'In Progress', 'Completed', 'Cancelled', 'No Show')),
  priority            TEXT NOT NULL DEFAULT 'Normal'
                        CHECK (priority IN ('Critical', 'High', 'Normal', 'Low')),
  special_instructions TEXT,
  assigned_vehicle    TEXT,
  driver_id           UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  estimated_duration  TEXT,
  estimated_distance  NUMERIC(10,2),
  actual_duration     TEXT,
  actual_distance     NUMERIC(10,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, request_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_requests_property  ON transport_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_status    ON transport_requests(property_id, status);
CREATE INDEX IF NOT EXISTS idx_transport_requests_scheduled ON transport_requests(property_id, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_transport_requests_guest     ON transport_requests(guest_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_driver    ON transport_requests(driver_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS transport_requests_updated_at ON transport_requests;
CREATE TRIGGER transport_requests_updated_at
  BEFORE UPDATE ON transport_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_requests TO authenticated;

ALTER TABLE transport_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_requests_read ON transport_requests;
CREATE POLICY transport_requests_read ON transport_requests
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_requests_write ON transport_requests;
CREATE POLICY transport_requests_write ON transport_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  v_driver UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_requests WHERE property_id = v_main) THEN
    SELECT id INTO v_driver FROM transport_drivers WHERE property_id = v_main AND status = 'Active' ORDER BY performance DESC LIMIT 1;

    INSERT INTO transport_requests
      (property_id, request_number, guest_id, guest_name, room, type, source, pickup_location, destination, scheduled_time, passenger_count, luggage_count, status, priority, special_instructions, assigned_vehicle, driver_id)
    VALUES
      (v_main, 'TR-001',
        (SELECT id FROM guests WHERE name ILIKE 'John Smith' LIMIT 1),
        'John Smith', '302', 'Airport Pickup', 'Front Office',
        'JFK Airport - Terminal 4', 'Hotel Main Entrance',
        '2026-07-30 14:30:00+00', 2, 3, 'Driver En Route', 'High',
        'Flight AA-1245. Guest will wait at arrivals hall.', 'VH-003',
        (SELECT id FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-003' LIMIT 1)),
      (v_main, 'TR-002',
        (SELECT id FROM guests WHERE name ILIKE 'Sarah Johnson' LIMIT 1),
        'Sarah Johnson', '415', 'City Transfer', 'Concierge',
        'Hotel Lobby', 'Times Square',
        '2026-07-30 16:00:00+00', 4, 2, 'Requested', 'Normal',
        NULL, NULL, NULL),
      (v_main, 'TR-003',
        NULL,
        'Corporate Event', NULL, 'Hotel Shuttle', 'Events & Banquets',
        'Hotel Main Entrance', 'Convention Center',
        '2026-07-30 18:00:00+00', 25, 0, 'In Progress', 'High',
        'Conference shuttle - signage required.', 'VH-007', v_driver),
      (v_main, 'TR-004',
        (SELECT id FROM guests WHERE name ILIKE 'Michael Brown' LIMIT 1),
        'Michael Brown', '512', 'Airport Drop-off', 'Guest Mobile App',
        'Hotel Lobby', 'LGA Airport - Terminal B',
        '2026-07-30 19:30:00+00', 1, 2, 'Completed', 'Normal',
        NULL, 'VH-003', v_driver),
      (v_main, 'TR-005',
        (SELECT id FROM guests WHERE name ILIKE 'Emily Davis' LIMIT 1),
        'Emily Davis', '228', 'Sightseeing Tour', 'Concierge',
        'Hotel Lobby', 'City Tour - Multiple Stops',
        '2026-07-31 09:00:00+00', 2, 1, 'Requested', 'Low',
        'Prefers English-speaking guide.', NULL, NULL),
      (v_main, 'TR-006',
        NULL,
        'VIP Guest', 'Penthouse', 'VIP Transport', 'Reservation System',
        'Hotel VIP Entrance', 'Private Airport',
        '2026-07-31 06:00:00+00', 3, 5, 'Guest Picked Up', 'Critical',
        'Discretion required. Security escort arranged.', 'VH-012',
        (SELECT id FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-012' LIMIT 1));
  END IF;
END $$;
