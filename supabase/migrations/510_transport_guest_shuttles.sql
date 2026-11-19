-- Transportation Guest Shuttle Routes & Boarding
-- Extends transport_shuttles for guest-facing scheduled routes (number,
-- frequency, next departure, broader status set) and adds a boarding list
-- table linking guests to shuttle departures.

-- ============================================================================
-- Extend transport_shuttles
-- ============================================================================
ALTER TABLE transport_shuttles ADD COLUMN IF NOT EXISTS shuttle_number TEXT;
ALTER TABLE transport_shuttles ADD COLUMN IF NOT EXISTS next_departure TEXT;
ALTER TABLE transport_shuttles ADD COLUMN IF NOT EXISTS frequency TEXT;

ALTER TABLE transport_shuttles DROP CONSTRAINT IF EXISTS transport_shuttles_status_check;
ALTER TABLE transport_shuttles ADD CONSTRAINT transport_shuttles_status_check
  CHECK (status IN ('Active', 'Scheduled', 'Completed', 'Cancelled', 'Standby', 'In Transit', 'Maintenance'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_shuttles_number
  ON transport_shuttles(property_id, shuttle_number) WHERE shuttle_number IS NOT NULL;

-- Backfill numbers for existing (staff) shuttles
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  WITH numbered AS (
    SELECT id, 'SH-' || lpad(rn::text, 3, '0') AS num
    FROM (SELECT id, row_number() OVER (ORDER BY created_at) AS rn
          FROM transport_shuttles WHERE property_id = v_main AND shuttle_number IS NULL) t
  )
  UPDATE transport_shuttles s SET shuttle_number = n.num
  FROM numbered n WHERE s.id = n.id AND s.shuttle_number IS NULL;
END $$;

-- ============================================================================
-- transport_shuttle_boarding
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_shuttle_boarding (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  shuttle_id     UUID NOT NULL REFERENCES transport_shuttles(id) ON DELETE CASCADE,
  guest_id       TEXT REFERENCES guests(id) ON DELETE SET NULL,
  guest_name     TEXT NOT NULL,
  room           TEXT,
  pickup         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  scheduled_time TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'Confirmed'
                   CHECK (status IN ('Confirmed', 'Waiting', 'Checked In', 'Boarded', 'No Show', 'Cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shuttle_boarding_property ON transport_shuttle_boarding(property_id);
CREATE INDEX IF NOT EXISTS idx_shuttle_boarding_shuttle  ON transport_shuttle_boarding(shuttle_id);
CREATE INDEX IF NOT EXISTS idx_shuttle_boarding_guest    ON transport_shuttle_boarding(guest_id);

DROP TRIGGER IF EXISTS transport_shuttle_boarding_updated_at ON transport_shuttle_boarding;
CREATE TRIGGER transport_shuttle_boarding_updated_at
  BEFORE UPDATE ON transport_shuttle_boarding
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_shuttle_boarding TO authenticated;

ALTER TABLE transport_shuttle_boarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_shuttle_boarding_read ON transport_shuttle_boarding;
CREATE POLICY transport_shuttle_boarding_read ON transport_shuttle_boarding
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_shuttle_boarding_write ON transport_shuttle_boarding;
CREATE POLICY transport_shuttle_boarding_write ON transport_shuttle_boarding
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed guest shuttle routes + boarding list for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  d1 UUID; d2 UUID; d3 UUID; d4 UUID;
  sh1 UUID; sh2 UUID;
  today_1400 TIMESTAMPTZ := CURRENT_DATE::timestamptz + interval '14 hours';
  today_1430 TIMESTAMPTZ := CURRENT_DATE::timestamptz + interval '14.5 hours';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_shuttles WHERE property_id = v_main AND name = 'Airport Express') THEN
    SELECT id INTO d1 FROM transport_drivers WHERE property_id = v_main AND status = 'Active' ORDER BY created_at LIMIT 1;
    SELECT id INTO d2 FROM transport_drivers WHERE property_id = v_main AND status = 'Active' AND id IS DISTINCT FROM d1 ORDER BY created_at LIMIT 1;
    SELECT id INTO d3 FROM transport_drivers WHERE property_id = v_main AND status = 'Active' AND id IS DISTINCT FROM d1 AND id IS DISTINCT FROM d2 ORDER BY created_at LIMIT 1;
    SELECT id INTO d4 FROM transport_drivers WHERE property_id = v_main AND status = 'Active' AND id IS DISTINCT FROM d1 AND id IS DISTINCT FROM d2 AND id IS DISTINCT FROM d3 ORDER BY created_at LIMIT 1;

    INSERT INTO transport_shuttles
      (property_id, shuttle_number, name, type, route, stops, schedule, next_departure, frequency,
       assigned_vehicle, driver_id, capacity, current_occupancy, status, department)
    VALUES
      (v_main, 'SH-004', 'Airport Express', 'Scheduled Route', 'Hotel ↔ JFK Airport',
       '["Hotel Main Entrance", "Times Square", "JFK Terminal 4"]'::jsonb, 'Every 2 hours', '14:00', 'Fixed',
       'VH-020', d1, 24, 18, 'Active', 'Guest Services'),
      (v_main, 'SH-005', 'City Center Shuttle', 'Scheduled Route', 'Hotel ↔ Downtown',
       '["Hotel Main Entrance", "Central Park", "Times Square", "Empire State Building"]'::jsonb, 'Every hour', '14:30', 'Fixed',
       'VH-021', d2, 20, 12, 'Active', 'Guest Services'),
      (v_main, 'SH-006', 'Shopping Express', 'Scheduled Route', 'Hotel ↔ Shopping Mall',
       '["Hotel Main Entrance", "Fifth Avenue", "Shopping Mall"]'::jsonb, 'Every 3 hours', '15:00', 'Fixed',
       'VH-022', d3, 18, 8, 'Active', 'Guest Services'),
      (v_main, 'SH-007', 'On-Demand Shuttle', 'Demand-Based', 'Flexible',
       '["Variable based on requests"]'::jsonb, 'On request', NULL, 'On-Demand',
       'VH-023', NULL, 16, 0, 'Standby', 'Guest Services'),
      (v_main, 'SH-008', 'Conference Shuttle', 'Special Event', 'Hotel ↔ Convention Center',
       '["Hotel Main Entrance", "Convention Center"]'::jsonb, 'Event schedule', '18:00', 'Event',
       'VH-024', d4, 30, 0, 'Scheduled', 'Events');
  END IF;

  SELECT id INTO sh1 FROM transport_shuttles WHERE property_id = v_main AND name = 'Airport Express' LIMIT 1;
  SELECT id INTO sh2 FROM transport_shuttles WHERE property_id = v_main AND name = 'City Center Shuttle' LIMIT 1;

  IF sh1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transport_shuttle_boarding WHERE property_id = v_main) THEN
    INSERT INTO transport_shuttle_boarding
      (property_id, shuttle_id, guest_id, guest_name, room, pickup, destination, scheduled_time, status)
    VALUES
      (v_main, sh1, (SELECT id FROM guests WHERE name ILIKE 'John Smith' LIMIT 1), 'John Smith', '302',
       'Hotel Main Entrance', 'JFK Terminal 4', today_1400, 'Checked In'),
      (v_main, sh1, (SELECT id FROM guests WHERE name ILIKE 'Sarah Johnson' LIMIT 1), 'Sarah Johnson', '415',
       'Hotel Main Entrance', 'JFK Terminal 4', today_1400, 'Checked In'),
      (v_main, sh2, (SELECT id FROM guests WHERE name ILIKE 'Michael Brown' LIMIT 1), 'Michael Brown', '512',
       'Hotel Main Entrance', 'Times Square', today_1430, 'Waiting'),
      (v_main, sh2, (SELECT id FROM guests WHERE name ILIKE 'Emily Davis' LIMIT 1), 'Emily Davis', '228',
       'Hotel Main Entrance', 'Central Park', today_1430, 'Waiting'),
      (v_main, sh2, (SELECT id FROM guests WHERE name ILIKE 'Robert Wilson' LIMIT 1), 'Robert Wilson', '318',
       'Hotel Main Entrance', 'Empire State Building', today_1430, 'Confirmed');
  END IF;
END $$;
