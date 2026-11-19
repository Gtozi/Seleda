-- 515_transport_vehicle_telemetry.sql
-- Latest GPS telemetry per fleet vehicle + linked active trip.
-- One row per vehicle (latest known position), upserted by the GPS API.

CREATE TABLE IF NOT EXISTS transport_vehicle_telemetry (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  vehicle_id       UUID NOT NULL REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  latitude         NUMERIC(10,6),
  longitude        NUMERIC(10,6),
  speed_kmh        INTEGER NOT NULL DEFAULT 0 CHECK (speed_kmh >= 0),
  heading          INTEGER NOT NULL DEFAULT 0 CHECK (heading >= 0 AND heading <= 360),
  status           TEXT NOT NULL DEFAULT 'Parked'
                     CHECK (status IN ('In Transit', 'Parked', 'Waiting', 'Offline')),
  location_label   TEXT,
  last_update      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  destination      TEXT,
  eta_minutes      INTEGER CHECK (eta_minutes IS NULL OR eta_minutes >= 0),
  trip_id          UUID REFERENCES transport_requests(id) ON DELETE SET NULL,
  route_deviation  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_telemetry_property ON transport_vehicle_telemetry(property_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_telemetry_status   ON transport_vehicle_telemetry(property_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_telemetry_trip     ON transport_vehicle_telemetry(trip_id);

DROP TRIGGER IF EXISTS transport_vehicle_telemetry_updated_at ON transport_vehicle_telemetry;
CREATE TRIGGER transport_vehicle_telemetry_updated_at
  BEFORE UPDATE ON transport_vehicle_telemetry
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_vehicle_telemetry TO authenticated;

ALTER TABLE transport_vehicle_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_vehicle_telemetry_read ON transport_vehicle_telemetry;
CREATE POLICY transport_vehicle_telemetry_read ON transport_vehicle_telemetry
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_vehicle_telemetry_write ON transport_vehicle_telemetry;
CREATE POLICY transport_vehicle_telemetry_write ON transport_vehicle_telemetry
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: live telemetry for the mock's tracked vehicles ────────────────────
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  vid_003 UUID; vid_007 UUID; vid_012 UUID; vid_001 UUID; vid_008 UUID; vid_004 UUID;
  tr_001 UUID; tr_003 UUID; tr_006 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_vehicle_telemetry WHERE property_id = v_main) THEN
    SELECT id INTO vid_003 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-003';
    SELECT id INTO vid_007 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-007';
    SELECT id INTO vid_012 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-012';
    SELECT id INTO vid_001 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-001';
    SELECT id INTO vid_008 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-008';
    SELECT id INTO vid_004 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-004';
    SELECT id INTO tr_001 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-001';
    SELECT id INTO tr_003 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-003';
    SELECT id INTO tr_006 FROM transport_requests WHERE property_id = v_main AND request_number = 'TR-006';

    INSERT INTO transport_vehicle_telemetry
      (property_id, vehicle_id, latitude, longitude, speed_kmh, heading, status,
       location_label, last_update, destination, eta_minutes, trip_id, route_deviation)
    VALUES
      (v_main, vid_003, 40.6413, -73.7781, 45, 180, 'In Transit',
       'JFK Airport - Terminal 4', NOW() - interval '2 minutes', 'Hotel Main Entrance', 15, tr_001, FALSE),
      (v_main, vid_007, 40.7580, -73.9754, 35, 90, 'In Transit',
       'Midtown Tunnel', NOW() - interval '1 minute', 'Convention Center', 25, tr_003, FALSE),
      (v_main, vid_012, 40.7589, -73.9851, 55, 270, 'In Transit',
       'FDR Drive', NOW(), 'Private Airport', 10, tr_006, FALSE),
      (v_main, vid_001, 40.7580, -73.9855, 0, 0, 'Waiting',
       'Times Square', NOW() - interval '5 minutes', NULL, NULL, NULL, FALSE),
      (v_main, vid_004, 40.7614, -73.9776, 0, 0, 'Parked',
       'Hotel Garage', NOW() - interval '30 seconds', NULL, NULL, NULL, FALSE),
      (v_main, vid_008, NULL, NULL, 0, 0, 'Offline',
       'Unknown', NOW() - interval '2 hours', NULL, NULL, NULL, FALSE);
  END IF;
END $$;
