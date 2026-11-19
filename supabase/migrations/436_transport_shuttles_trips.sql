-- Transportation Staff Shuttles & Trips
-- Links trips and shuttles to shared HR employees and transport_drivers.

-- ============================================================================
-- transport_shuttles
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_shuttles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  route           TEXT NOT NULL,
  stops           JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule        TEXT,
  assigned_vehicle TEXT,
  driver_id       UUID REFERENCES transport_drivers(id),
  capacity        INTEGER NOT NULL DEFAULT 0,
  current_occupancy INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Active'
                    CHECK (status IN ('Active', 'Scheduled', 'Completed', 'Cancelled')),
  department      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_shuttles_property ON transport_shuttles(property_id);

-- ============================================================================
-- transport_trips
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_trips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  type            TEXT NOT NULL,
  pickup          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  actual_at       TIMESTAMPTZ,
  vehicle         TEXT,
  driver_id       UUID REFERENCES transport_drivers(id),
  status          TEXT NOT NULL DEFAULT 'Scheduled'
                    CHECK (status IN ('Scheduled', 'In Progress', 'Completed', 'Cancelled')),
  shift           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_trips_property ON transport_trips(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_trips_employee ON transport_trips(employee_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS transport_shuttles_updated_at ON transport_shuttles;
CREATE TRIGGER transport_shuttles_updated_at
  BEFORE UPDATE ON transport_shuttles
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

DROP TRIGGER IF EXISTS transport_trips_updated_at ON transport_trips;
CREATE TRIGGER transport_trips_updated_at
  BEFORE UPDATE ON transport_trips
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_shuttles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_trips TO authenticated;

ALTER TABLE transport_shuttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_shuttles_read ON transport_shuttles;
CREATE POLICY transport_shuttles_read ON transport_shuttles
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_shuttles_write ON transport_shuttles;
CREATE POLICY transport_shuttles_write ON transport_shuttles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

DROP POLICY IF EXISTS transport_trips_read ON transport_trips;
CREATE POLICY transport_trips_read ON transport_trips
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_trips_write ON transport_trips;
CREATE POLICY transport_trips_write ON transport_trips
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  d_morning UUID;
  d_evening UUID;
  d_night UUID;
  emp_ids TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_shuttles WHERE property_id = v_main) THEN
    SELECT id INTO d_morning FROM transport_drivers WHERE property_id = v_main AND shift = 'Morning' LIMIT 1;
    SELECT id INTO d_evening FROM transport_drivers WHERE property_id = v_main AND shift = 'Afternoon' LIMIT 1;
    SELECT id INTO d_night FROM transport_drivers WHERE property_id = v_main AND status = 'Active' AND id != d_morning AND id != d_evening LIMIT 1;

    INSERT INTO transport_shuttles (property_id, name, type, route, stops, schedule, assigned_vehicle, driver_id, capacity, current_occupancy, status, department)
    VALUES
      (v_main, 'Morning Shift Shuttle', 'Staff Shuttle', 'Downtown ↔ Hotel', '["Central Station", "Business District", "Hotel Employee Entrance"]'::jsonb, '06:00, 07:00, 08:00', 'VH-030', d_morning, 20, 15, 'Active', 'All Departments'),
      (v_main, 'Evening Shift Shuttle', 'Staff Shuttle', 'Hotel ↔ Downtown', '["Hotel Employee Entrance", "Business District", "Central Station"]'::jsonb, '17:00, 18:00, 19:00', 'VH-031', d_evening, 20, 0, 'Scheduled', 'All Departments'),
      (v_main, 'Night Shift Transport', 'Shift Transportation', 'Hotel ↔ Residential Areas', '["Hotel Employee Entrance", "Residential Complex A", "Residential Complex B"]'::jsonb, '22:00, 23:00, 00:00', 'VH-032', d_night, 15, 0, 'Scheduled', 'Housekeeping, Engineering');

    SELECT ARRAY(SELECT id FROM employees WHERE property_id = v_main ORDER BY created_at LIMIT 5) INTO emp_ids;

    IF array_length(emp_ids, 1) >= 5 THEN
      INSERT INTO transport_trips (property_id, employee_id, type, pickup, destination, scheduled_at, actual_at, vehicle, driver_id, status, shift)
      VALUES
        (v_main, emp_ids[1], 'Staff Pickup', 'Central Station', 'Hotel Employee Entrance', '2026-07-30 07:00:00+00', '2026-07-30 07:05:00+00', 'VH-030', d_morning, 'Completed', 'Morning'),
        (v_main, emp_ids[2], 'Staff Pickup', 'Business District', 'Hotel Employee Entrance', '2026-07-30 08:00:00+00', NULL, 'VH-030', d_morning, 'Scheduled', 'Morning'),
        (v_main, emp_ids[3], 'Staff Drop-off', 'Hotel Employee Entrance', 'Residential Complex A', '2026-07-30 18:00:00+00', NULL, 'VH-031', d_evening, 'Scheduled', 'Evening'),
        (v_main, emp_ids[4], 'Staff Pickup', 'Central Station', 'Hotel Employee Entrance', '2026-07-30 06:00:00+00', '2026-07-30 06:02:00+00', 'VH-030', d_morning, 'Completed', 'Morning'),
        (v_main, emp_ids[5], 'Shift Transportation', 'Hotel Employee Entrance', 'Residential Complex B', '2026-07-30 23:00:00+00', NULL, 'VH-032', d_night, 'Scheduled', 'Night');
    END IF;
  END IF;
END $$;
