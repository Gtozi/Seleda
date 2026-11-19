-- 522_transport_config_items.sql
-- Transportation configuration lists — transportation types, service areas,
-- vehicle categories, fuel types, and driver groups. One grouped table rather
-- than five parallel ones; group-specific fields are nullable columns.

CREATE TABLE IF NOT EXISTS transport_config_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  item_group  TEXT NOT NULL
                CHECK (item_group IN ('transport_type', 'service_area', 'vehicle_category', 'fuel_type', 'driver_group')),
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  base_rate   NUMERIC(10,2),          -- transport_type only
  description TEXT,                    -- service_area only
  capacity    INTEGER CHECK (capacity IS NULL OR capacity > 0),  -- vehicle_category only
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_config_items_unique
  ON transport_config_items(property_id, item_group, name);
CREATE INDEX IF NOT EXISTS idx_transport_config_items_property
  ON transport_config_items(property_id, item_group, sort_order);

DROP TRIGGER IF EXISTS transport_config_items_updated_at ON transport_config_items;
CREATE TRIGGER transport_config_items_updated_at
  BEFORE UPDATE ON transport_config_items
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_config_items TO authenticated;

ALTER TABLE transport_config_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_config_items_read ON transport_config_items;
CREATE POLICY transport_config_items_read ON transport_config_items
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_config_items_write ON transport_config_items;
CREATE POLICY transport_config_items_write ON transport_config_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's configuration lists for GH-MAIN ─────────────────────────
INSERT INTO transport_config_items (property_id, item_group, name, active, base_rate, description, capacity, sort_order)
SELECT * FROM (VALUES
  -- Transportation Types
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'Airport Pickup',    TRUE,  85.00::numeric,  NULL::text, NULL::int, 1),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'Airport Drop-off',  TRUE,  95.00,           NULL,        NULL,      2),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'City Transfer',     TRUE,  45.00,           NULL,        NULL,      3),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'Hotel Shuttle',     TRUE,  0.00,            NULL,        NULL,      4),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'Sightseeing Tour',  TRUE,  180.00,          NULL,        NULL,      5),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'VIP Transport',     TRUE,  350.00,          NULL,        NULL,      6),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'Staff Shuttle',     TRUE,  0.00,            NULL,        NULL,      7),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'transport_type', 'Courier Service',   FALSE, 35.00,           NULL,        NULL,      8),
  -- Service Areas
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'service_area', 'Manhattan',      TRUE,  NULL, 'Primary service area',    NULL, 1),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'service_area', 'Brooklyn',       TRUE,  NULL, 'Secondary service area',  NULL, 2),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'service_area', 'Queens',         TRUE,  NULL, 'Airport service area',    NULL, 3),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'service_area', 'Bronx',          FALSE, NULL, 'Limited service',         NULL, 4),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'service_area', 'Staten Island',  FALSE, NULL, 'On-demand only',          NULL, 5),
  -- Vehicle Categories
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'Sedan',       TRUE, NULL, NULL, 4::int,  1),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'SUV',         TRUE, NULL, NULL, 7,       2),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'Van',         TRUE, NULL, NULL, 12,      3),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'Minibus',     TRUE, NULL, NULL, 20,      4),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'Luxury',      TRUE, NULL, NULL, 4,       5),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'Electric',    TRUE, NULL, NULL, 5,       6),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'vehicle_category', 'Shuttle Bus', TRUE, NULL, NULL, 30,      7),
  -- Fuel Types
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'fuel_type', 'Gasoline', TRUE,  NULL, NULL, NULL, 1),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'fuel_type', 'Diesel',   TRUE,  NULL, NULL, NULL, 2),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'fuel_type', 'Electric', TRUE,  NULL, NULL, NULL, 3),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'fuel_type', 'Hybrid',   TRUE,  NULL, NULL, NULL, 4),
  -- Driver Groups
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'driver_group', 'Regular Drivers',   TRUE, NULL, NULL, NULL, 1),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'driver_group', 'VIP Drivers',       TRUE, NULL, NULL, NULL, 2),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'driver_group', 'Shuttle Drivers',   TRUE, NULL, NULL, NULL, 3),
  ('18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'driver_group', 'Contract Drivers',  TRUE, NULL, NULL, NULL, 4)
) AS s(property_id, item_group, name, active, base_rate, description, capacity, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM transport_config_items WHERE property_id = '18762279-a389-41c9-9169-7ebc682e9703');
