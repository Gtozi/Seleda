-- Transportation Driver Management
-- Links drivers to the shared HR employees table.

-- ============================================================================
-- transport_drivers
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_drivers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  employee_id       TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  license_number    TEXT NOT NULL,
  license_category  TEXT,
  license_expiry    DATE,
  medical_certificate DATE,
  certifications    JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_vehicle  TEXT,
  shift             TEXT,
  incidents         INTEGER NOT NULL DEFAULT 0,
  total_trips       INTEGER NOT NULL DEFAULT 0,
  performance       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'Active'
                      CHECK (status IN ('Active', 'On Leave', 'Suspended', 'Inactive')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_drivers_property ON transport_drivers(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_drivers_employee ON transport_drivers(employee_id);

-- ============================================================================
-- Triggers
-- ============================================================================
DROP TRIGGER IF EXISTS transport_drivers_updated_at ON transport_drivers;
CREATE TRIGGER transport_drivers_updated_at
  BEFORE UPDATE ON transport_drivers
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

-- ============================================================================
-- Grants & RLS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON transport_drivers TO authenticated;

ALTER TABLE transport_drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_drivers_read ON transport_drivers;
CREATE POLICY transport_drivers_read ON transport_drivers
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_drivers_write ON transport_drivers;
CREATE POLICY transport_drivers_write ON transport_drivers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
  emp_ids UUID[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_drivers WHERE property_id = v_main) THEN
    SELECT ARRAY(SELECT id FROM employees WHERE property_id = v_main ORDER BY created_at LIMIT 6) INTO emp_ids;
    IF array_length(emp_ids, 1) >= 6 THEN
      INSERT INTO transport_drivers (property_id, employee_id, license_number, license_category, license_expiry, medical_certificate, certifications, assigned_vehicle, shift, incidents, total_trips, performance, status)
      VALUES
        (v_main, emp_ids[1], 'DL-12345678', 'Class C', '2027-03-15', '2026-12-31', '["Defensive Driving", "First Aid", "Customer Service"]'::jsonb, 'VH-003', 'Morning', 0, 1250, 95, 'Active'),
        (v_main, emp_ids[2], 'DL-23456789', 'Class C', '2026-11-30', '2026-10-15', '["Defensive Driving", "VIP Service"]'::jsonb, 'VH-001', 'Morning', 0, 1580, 98, 'Active'),
        (v_main, emp_ids[3], 'DL-34567890', 'Class B', '2027-06-20', '2027-01-31', '["Defensive Driving", "First Aid", "Heavy Vehicle"]'::jsonb, 'VH-004', 'Afternoon', 1, 2100, 92, 'Active'),
        (v_main, emp_ids[4], 'DL-45678901', 'Class C', '2026-08-15', '2026-09-30', '["Defensive Driving", "VIP Service", "First Aid"]'::jsonb, 'VH-012', 'Flexible', 0, 680, 96, 'Active'),
        (v_main, emp_ids[5], 'DL-56789012', 'Class C', '2027-01-10', '2026-11-15', '["Defensive Driving"]'::jsonb, NULL, 'N/A', 2, 920, 88, 'On Leave'),
        (v_main, emp_ids[6], 'DL-67890123', 'Class B', '2026-09-30', '2026-08-20', '["Defensive Driving", "Heavy Vehicle"]'::jsonb, 'VH-030', 'Morning', 1, 2850, 90, 'Active');
    END IF;
  END IF;
END $$;
