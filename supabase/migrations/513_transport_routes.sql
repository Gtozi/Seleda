-- Transportation Routes
-- Standard/dynamic route definitions with distance, time and cost estimates.

-- ============================================================================
-- transport_routes
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_routes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  route_number     TEXT NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'Standard Route'
                     CHECK (type IN ('Standard Route', 'Dynamic Route', 'Express Route')),
  category         TEXT NOT NULL DEFAULT 'City Transfer'
                     CHECK (category IN ('Airport Transfer', 'City Transfer', 'Corporate Transfer', 'Tour Transportation', 'Staff Transportation')),
  start_point      TEXT NOT NULL,
  end_point        TEXT NOT NULL,
  distance         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (distance >= 0),
  estimated_time   INTEGER NOT NULL DEFAULT 0 CHECK (estimated_time >= 0),
  toll_cost        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (toll_cost >= 0),
  fuel_cost        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fuel_cost >= 0),
  status           TEXT NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive', 'Seasonal')),
  frequent_stops   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, route_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_routes_property ON transport_routes(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_routes_status   ON transport_routes(property_id, status);
CREATE INDEX IF NOT EXISTS idx_transport_routes_category ON transport_routes(property_id, category);

-- ============================================================================
-- Triggers / Grants / RLS
-- ============================================================================
DROP TRIGGER IF EXISTS transport_routes_updated_at ON transport_routes;
CREATE TRIGGER transport_routes_updated_at
  BEFORE UPDATE ON transport_routes
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_routes TO authenticated;

ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_routes_read ON transport_routes;
CREATE POLICY transport_routes_read ON transport_routes
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_routes_write ON transport_routes;
CREATE POLICY transport_routes_write ON transport_routes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ============================================================================
-- Seed demo data for GH-MAIN
-- ============================================================================
DO $$
DECLARE
  v_main UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transport_routes WHERE property_id = v_main) THEN
    INSERT INTO transport_routes
      (property_id, route_number, name, type, category, start_point, end_point,
       distance, estimated_time, toll_cost, fuel_cost, status, frequent_stops)
    VALUES
      (v_main, 'RT-001', 'Hotel to JFK Airport', 'Standard Route', 'Airport Transfer',
       'Hotel Main Entrance', 'JFK Airport - Terminal 4', 25, 45, 15.00, 12.50, 'Active',
       '["Midtown Tunnel", "Van Wyck Expressway"]'::jsonb),
      (v_main, 'RT-002', 'Hotel to LGA Airport', 'Standard Route', 'Airport Transfer',
       'Hotel Main Entrance', 'LGA Airport - Terminal B', 18, 35, 8.50, 9.00, 'Active',
       '["Grand Central Parkway", "LaGuardia Access Road"]'::jsonb),
      (v_main, 'RT-003', 'Hotel to Times Square', 'Standard Route', 'City Transfer',
       'Hotel Main Entrance', 'Times Square', 5, 20, 0.00, 3.50, 'Active',
       '["5th Avenue", "Rockefeller Center"]'::jsonb),
      (v_main, 'RT-004', 'Hotel to Convention Center', 'Standard Route', 'Corporate Transfer',
       'Hotel Main Entrance', 'Javits Convention Center', 8, 25, 5.00, 5.50, 'Active',
       '["Hudson Yards", "West Side Highway"]'::jsonb),
      (v_main, 'RT-005', 'Shopping District Tour', 'Dynamic Route', 'Tour Transportation',
       'Hotel Main Entrance', 'Hotel Main Entrance', 15, 120, 0.00, 10.00, 'Active',
       '["Fifth Avenue", "Madison Avenue", "SoHo"]'::jsonb),
      (v_main, 'RT-006', 'Hotel to Wall Street', 'Standard Route', 'Corporate Transfer',
       'Hotel VIP Entrance', 'Wall Street', 12, 30, 12.00, 7.50, 'Inactive',
       '["Brooklyn Bridge", "Financial District"]'::jsonb);
  END IF;
END $$;
