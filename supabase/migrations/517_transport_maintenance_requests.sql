-- 517_transport_maintenance_requests.sql
-- Maintenance requests for the Vehicle Maintenance Interface page.

CREATE TABLE IF NOT EXISTS transport_maintenance_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  request_number   TEXT NOT NULL,
  vehicle_id       UUID REFERENCES transport_vehicles(id) ON DELETE SET NULL,
  type             TEXT NOT NULL DEFAULT 'Preventive Maintenance'
                     CHECK (type IN ('Preventive Maintenance', 'Breakdown Repair', 'Inspection', 'Emergency Repair')),
  priority         TEXT NOT NULL DEFAULT 'Normal'
                     CHECK (priority IN ('High', 'Normal', 'Low')),
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'Pending'
                     CHECK (status IN ('Pending', 'In Progress', 'Scheduled', 'Completed', 'Cancelled')),
  requested_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  scheduled_date   DATE,
  completed_date   DATE,
  estimated_cost   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  actual_cost      NUMERIC(10,2) CHECK (actual_cost IS NULL OR actual_cost >= 0),
  vendor           TEXT,
  assigned_to      TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, request_number)
);

CREATE INDEX IF NOT EXISTS idx_maint_req_property ON transport_maintenance_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_maint_req_status   ON transport_maintenance_requests(property_id, status);
CREATE INDEX IF NOT EXISTS idx_maint_req_vehicle  ON transport_maintenance_requests(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_req_sched    ON transport_maintenance_requests(property_id, scheduled_date);

DROP TRIGGER IF EXISTS transport_maintenance_requests_updated_at ON transport_maintenance_requests;
CREATE TRIGGER transport_maintenance_requests_updated_at
  BEFORE UPDATE ON transport_maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_maintenance_requests TO authenticated;

ALTER TABLE transport_maintenance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_maintenance_requests_read ON transport_maintenance_requests;
CREATE POLICY transport_maintenance_requests_read ON transport_maintenance_requests
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_maintenance_requests_write ON transport_maintenance_requests;
CREATE POLICY transport_maintenance_requests_write ON transport_maintenance_requests
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's requests for GH-MAIN ───────────────────────────────────
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  vh005 UUID; vh003 UUID; vh004 UUID; vh001 UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_maintenance_requests WHERE property_id = v_main) THEN
    SELECT id INTO vh005 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-005';
    SELECT id INTO vh003 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-003';
    SELECT id INTO vh004 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-004';
    SELECT id INTO vh001 FROM transport_vehicles WHERE property_id = v_main AND vehicle_number = 'VH-001';

    INSERT INTO transport_maintenance_requests
      (property_id, request_number, vehicle_id, type, priority, description, status,
       requested_date, scheduled_date, completed_date, estimated_cost, actual_cost, vendor, assigned_to)
    VALUES
      (v_main, 'MR-001', vh005, 'Preventive Maintenance', 'Normal',
       'Scheduled service - oil change, filter replacement', 'In Progress',
       CURRENT_DATE - 2, CURRENT_DATE, NULL, 450.00, NULL, 'BMW Service Center', 'Engineering Team'),
      (v_main, 'MR-002', vh003, 'Breakdown Repair', 'High',
       'Engine overheating issue - cooling system failure', 'Pending',
       CURRENT_DATE, NULL, NULL, 1200.00, NULL, 'TBD', NULL),
      (v_main, 'MR-003', vh004, 'Preventive Maintenance', 'Normal',
       'Brake inspection and replacement', 'Completed',
       CURRENT_DATE - 5, CURRENT_DATE - 3, CURRENT_DATE - 3, 680.00, 720.00, 'Mercedes Commercial', 'Engineering Team'),
      (v_main, 'MR-004', vh001, 'Inspection', 'Low',
       'Monthly safety inspection', 'Scheduled',
       CURRENT_DATE, CURRENT_DATE + 5, NULL, 150.00, NULL, 'Hotel Garage', 'Engineering Team');
  END IF;
END $$;
