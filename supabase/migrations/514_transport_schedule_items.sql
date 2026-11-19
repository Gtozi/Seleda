-- Transportation Schedule Items
-- Day-level dispatch schedule entries linking drivers and vehicles to trips.

-- ============================================================================
-- transport_schedule_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_schedule_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  schedule_number  TEXT NOT NULL,
  scheduled_time   TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  driver_id        UUID REFERENCES transport_drivers(id) ON DELETE SET NULL,
  assigned_vehicle TEXT,
  type             TEXT NOT NULL DEFAULT 'City Transfer',
  route            TEXT,
  status           TEXT NOT NULL DEFAULT 'Scheduled'
                     CHECK (status IN ('Scheduled', 'In Progress', 'Completed', 'Unassigned', 'Cancelled')),
  passenger_count  INTEGER NOT NULL DEFAULT 1 CHECK (passenger_count >= 1),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, schedule_number)
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_property  ON transport_schedule_items(property_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_scheduled ON transport_schedule_items(property_id, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_schedule_items_driver    ON transport_schedule_items(driver_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_status    ON transport_schedule_items(property_id, status);

-- ============================================================================
-- Triggers / Grants / RLS
-- ============================================================================
DROP TRIGGER IF EXISTS transport_schedule_items_updated_at ON transport_schedule_items;
CREATE TRIGGER transport_schedule_items_updated_at
  BEFORE UPDATE ON transport_schedule_items
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_schedule_items TO authenticated;

ALTER TABLE transport_schedule_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_schedule_items_read ON transport_schedule_items;
CREATE POLICY transport_schedule_items_read ON transport_schedule_items
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_schedule_items_write ON transport_schedule_items;
CREATE POLICY transport_schedule_items_write ON transport_schedule_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN (today's schedule)
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  d_vh001 UUID; d_vh002 UUID; d_vh003 UUID; d_vh004 UUID; d_vh007 UUID; d_vh012 UUID; d_any UUID;
  t0 DATE := CURRENT_DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_schedule_items WHERE property_id = v_main) THEN
    SELECT id INTO d_vh001 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-001' LIMIT 1;
    SELECT id INTO d_vh002 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-002' LIMIT 1;
    SELECT id INTO d_vh003 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-003' LIMIT 1;
    SELECT id INTO d_vh004 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-004' LIMIT 1;
    SELECT id INTO d_vh007 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-007' LIMIT 1;
    SELECT id INTO d_vh012 FROM transport_drivers WHERE property_id = v_main AND assigned_vehicle = 'VH-012' LIMIT 1;
    SELECT id INTO d_any FROM transport_drivers WHERE property_id = v_main AND status = 'Active'
      AND id IS DISTINCT FROM d_vh001 AND id IS DISTINCT FROM d_vh002 AND id IS DISTINCT FROM d_vh003
      AND id IS DISTINCT FROM d_vh004 AND id IS DISTINCT FROM d_vh007 AND id IS DISTINCT FROM d_vh012
      LIMIT 1;

    INSERT INTO transport_schedule_items
      (property_id, schedule_number, scheduled_time, duration_minutes, driver_id, assigned_vehicle,
       type, route, status, passenger_count)
    VALUES
      (v_main, 'SCH-001', t0 + interval '6 hours', 60, d_any, 'VH-030', 'Staff Shuttle', 'Morning Shift Shuttle', 'Completed', 15),
      (v_main, 'SCH-002', t0 + interval '7 hours', 45, d_vh003, 'VH-003', 'Airport Pickup', 'Hotel to JFK Airport', 'In Progress', 2),
      (v_main, 'SCH-003', t0 + interval '8 hours', 30, d_vh001, 'VH-001', 'City Transfer', 'Hotel to Times Square', 'Scheduled', 4),
      -- Intentional overlap with SCH-003 driver/vehicle to demonstrate conflict detection
      (v_main, 'SCH-004', t0 + interval '8 hours' + interval '15 minutes', 45, d_vh001, 'VH-001', 'VIP Transfer', 'Hotel to Fifth Avenue', 'Scheduled', 2),
      (v_main, 'SCH-005', t0 + interval '9 hours', 120, d_vh004, 'VH-004', 'Tour Transportation', 'City Sightseeing Tour', 'Scheduled', 3),
      (v_main, 'SCH-006', t0 + interval '10 hours', 45, d_vh012, 'VH-012', 'VIP Transfer', 'Hotel to Private Airport', 'Scheduled', 3),
      (v_main, 'SCH-007', t0 + interval '11 hours', 35, d_vh002, 'VH-002', 'Corporate Transfer', 'Hotel to Wall Street', 'Scheduled', 1),
      (v_main, 'SCH-008', t0 + interval '12 hours', 60, d_vh007, 'VH-007', 'Conference Shuttle', 'Hotel to Convention Center', 'Scheduled', 25),
      (v_main, 'SCH-009', t0 + interval '14 hours', 40, NULL, NULL, 'Airport Pickup', 'JFK to Hotel', 'Unassigned', 2),
      (v_main, 'SCH-010', t0 + interval '15 hours', 30, NULL, NULL, 'Shopping Trip', 'Hotel to Fifth Avenue', 'Unassigned', 2),
      (v_main, 'SCH-011', t0 + interval '16 hours', 45, d_any, 'VH-030', 'Staff Shuttle', 'Afternoon Shift Shuttle', 'Scheduled', 12);
  END IF;
END $$;
