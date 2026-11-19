-- Kitchen Management Schema
-- This migration creates tables for managing kitchen stations and links equipment
-- to the existing F&B inventory_items table (from migration 256).

-- Add "Equipment" category to inventory_categories (if it doesn't exist)
INSERT INTO inventory_categories (name, code, description, sort_order)
SELECT 'Equipment', 'EQUIP', 'Kitchen and outlet equipment', 8
WHERE NOT EXISTS (SELECT 1 FROM inventory_categories WHERE code = 'EQUIP');

-- Create kitchen_stations table
CREATE TABLE IF NOT EXISTS kitchen_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_name VARCHAR(255) NOT NULL,
  station_type VARCHAR(50) NOT NULL CHECK (station_type IN ('Hot', 'Cold', 'Prep', 'Grill', 'Sauté', 'Fry', 'Dessert', 'Beverage', 'Expo', 'Other')),
  outlet_id TEXT REFERENCES outlets(id) ON DELETE SET NULL,
  description TEXT,
  capacity_per_hour INTEGER DEFAULT 30 CHECK (capacity_per_hour > 0),
  active_hours_start TIME DEFAULT '06:00',
  active_hours_end TIME DEFAULT '22:00',
  is_active BOOLEAN DEFAULT true,
  kds_instance_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create junction table to link kitchen stations with F&B inventory items
CREATE TABLE IF NOT EXISTS kitchen_station_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES kitchen_stations(id) ON DELETE CASCADE,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  assigned_quantity INTEGER DEFAULT 1,
  status VARCHAR(50) DEFAULT 'Available' CHECK (status IN ('Available', 'In Use', 'Maintenance', 'Out of Service')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_kitchen_stations_outlet ON kitchen_stations(outlet_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_stations_type ON kitchen_stations(station_type);
CREATE INDEX IF NOT EXISTS idx_kitchen_stations_active ON kitchen_stations(is_active);
CREATE INDEX IF NOT EXISTS idx_kitchen_stations_kds ON kitchen_stations(kds_instance_id) WHERE kds_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kitchen_station_inventory_station ON kitchen_station_inventory(station_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_station_inventory_item ON kitchen_station_inventory(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_kitchen_station_inventory_status ON kitchen_station_inventory(status);

-- Add updated_at trigger function for kitchen_stations
CREATE OR REPLACE FUNCTION update_kitchen_stations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it for automatic updated_at
DROP TRIGGER IF EXISTS trigger_update_kitchen_stations_updated_at ON kitchen_stations;
CREATE TRIGGER trigger_update_kitchen_stations_updated_at
  BEFORE UPDATE ON kitchen_stations
  FOR EACH ROW
  EXECUTE FUNCTION update_kitchen_stations_updated_at();

-- Add comments for documentation
COMMENT ON TABLE kitchen_stations IS 'Kitchen preparation stations with capacity and scheduling information';
COMMENT ON TABLE kitchen_station_inventory IS 'Junction table linking kitchen stations with F&B inventory items';

COMMENT ON COLUMN kitchen_stations.station_type IS 'Type of kitchen station (Hot, Cold, Prep, Grill, etc.)';
COMMENT ON COLUMN kitchen_stations.capacity_per_hour IS 'Maximum number of orders/items this station can handle per hour';
COMMENT ON COLUMN kitchen_stations.kds_instance_id IS 'Optional link to Kitchen Display System instance for order routing';
COMMENT ON COLUMN kitchen_station_inventory.status IS 'Current operational status of the inventory item at this station';

-- ════════════════════════════════════════════════════════════════════════
-- SAMPLE DATA
-- ════════════════════════════════════════════════════════════════════════

-- Insert equipment items into F&B inventory_items (if they don't exist)
INSERT INTO inventory_items (category_id, name, description, unit_of_measure, current_quantity, minimum_stock, reorder_point, unit_cost, is_active)
SELECT
  ic.id,
  v.name,
  v.description,
  'PCS',
  1,
  0,
  0,
  0,
  true
FROM inventory_categories ic
CROSS JOIN (VALUES
  ('Charbroiler Grill', 'Commercial charbroiler for grilling meats and vegetables'),
  ('Flat Top Grill', 'Flat top griddle for bulk cooking'),
  ('Ventilation Hood', 'Kitchen ventilation system'),
  ('Sauté Burner', 'Commercial sauté burner range'),
  ('Gas Range', 'Multi-burner gas range'),
  ('Sauté Pans Set', 'Set of sauté pans in various sizes'),
  ('Prep Table', 'Stainless steel preparation table'),
  ('Walk-in Cooler', 'Walk-in refrigeration unit'),
  ('Food Processor', 'Commercial food processor'),
  ('Deep Fryer', 'Commercial deep fryer'),
  ('Filtration System', 'Oil filtration system for fryers'),
  ('Oil Storage', 'Cooking oil storage container'),
  ('Heat Lamps', 'Food warming heat lamps'),
  ('Pass Shelf', 'Expedition pass shelf'),
  ('POS Terminal', 'Point of sale terminal'),
  ('Convection Oven', 'Commercial convection oven'),
  ('Mixing Bowls Set', 'Set of mixing bowls'),
  ('Pastry Brush Set', 'Set of pastry brushes'),
  ('Espresso Machine', 'Commercial espresso machine'),
  ('Blender', 'Commercial blender'),
  ('Ice Machine', 'Commercial ice maker'),
  ('Measuring Cups', 'Set of measuring cups')
) AS v(name, description)
WHERE ic.code = 'EQUIP'
  AND NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = v.name);

-- Insert sample kitchen stations (only if they don't already exist)
INSERT INTO kitchen_stations (station_name, station_type, description, capacity_per_hour, active_hours_start, active_hours_end, is_active)
SELECT 
  station_name, station_type, description, capacity_per_hour,
  active_hours_start::time, active_hours_end::time, is_active
FROM (VALUES
  ('Main Grill Station', 'Grill', 'Primary grill station for main dining room', 50, '06:00', '23:00', true),
  ('Sauté Station', 'Sauté', 'Sauté and pan-fry preparation', 40, '06:00', '23:00', true),
  ('Cold Prep Station', 'Cold', 'Cold food preparation and salad station', 35, '05:00', '22:00', true),
  ('Fry Station', 'Fry', 'Deep frying preparation', 45, '11:00', '23:00', true),
  ('Expo/Pass Station', 'Expo', 'Final plating and quality control', 60, '06:00', '23:00', true),
  ('Dessert Station', 'Dessert', 'Pastry and dessert preparation', 25, '08:00', '22:00', true),
  ('Beverage Station', 'Beverage', 'Hot and cold beverage preparation', 55, '06:00', '00:00', true),
  ('Appetizer Prep', 'Prep', 'Appetizer and starter preparation', 30, '10:00', '23:00', true)
) AS v(station_name, station_type, description, capacity_per_hour, active_hours_start, active_hours_end, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM kitchen_stations WHERE station_name = v.station_name
);

-- Link kitchen stations to F&B inventory items (only if not already exists)
INSERT INTO kitchen_station_inventory (station_id, inventory_item_id, assigned_quantity, status, notes)
SELECT
  ks.id,
  ii.id,
  1,
  eq.status,
  'Assigned to ' || ks.station_name
FROM (
  -- Equipment for Main Grill Station
  SELECT id as station_id, 'Charbroiler Grill' as item_name, 'Available' as status FROM kitchen_stations WHERE station_name = 'Main Grill Station'
  UNION ALL
  SELECT id, 'Flat Top Grill', 'Available' FROM kitchen_stations WHERE station_name = 'Main Grill Station'
  UNION ALL
  SELECT id, 'Ventilation Hood', 'Available' FROM kitchen_stations WHERE station_name = 'Main Grill Station'

  UNION ALL
  -- Equipment for Sauté Station
  SELECT id, 'Sauté Burner', 'Available' FROM kitchen_stations WHERE station_name = 'Sauté Station'
  UNION ALL
  SELECT id, 'Gas Range', 'In Use' FROM kitchen_stations WHERE station_name = 'Sauté Station'
  UNION ALL
  SELECT id, 'Sauté Pans Set', 'Available' FROM kitchen_stations WHERE station_name = 'Sauté Station'

  UNION ALL
  -- Equipment for Cold Prep Station
  SELECT id, 'Prep Table', 'Available' FROM kitchen_stations WHERE station_name = 'Cold Prep Station'
  UNION ALL
  SELECT id, 'Walk-in Cooler', 'Available' FROM kitchen_stations WHERE station_name = 'Cold Prep Station'
  UNION ALL
  SELECT id, 'Food Processor', 'Available' FROM kitchen_stations WHERE station_name = 'Cold Prep Station'

  UNION ALL
  -- Equipment for Fry Station
  SELECT id, 'Deep Fryer', 'Available' FROM kitchen_stations WHERE station_name = 'Fry Station'
  UNION ALL
  SELECT id, 'Filtration System', 'Available' FROM kitchen_stations WHERE station_name = 'Fry Station'
  UNION ALL
  SELECT id, 'Oil Storage', 'Available' FROM kitchen_stations WHERE station_name = 'Fry Station'

  UNION ALL
  -- Equipment for Expo/Pass Station
  SELECT id, 'Heat Lamps', 'Available' FROM kitchen_stations WHERE station_name = 'Expo/Pass Station'
  UNION ALL
  SELECT id, 'Pass Shelf', 'Available' FROM kitchen_stations WHERE station_name = 'Expo/Pass Station'
  UNION ALL
  SELECT id, 'POS Terminal', 'Available' FROM kitchen_stations WHERE station_name = 'Expo/Pass Station'

  UNION ALL
  -- Equipment for Dessert Station
  SELECT id, 'Convection Oven', 'Available' FROM kitchen_stations WHERE station_name = 'Dessert Station'
  UNION ALL
  SELECT id, 'Mixing Bowls Set', 'Available' FROM kitchen_stations WHERE station_name = 'Dessert Station'
  UNION ALL
  SELECT id, 'Pastry Brush Set', 'Available' FROM kitchen_stations WHERE station_name = 'Dessert Station'

  UNION ALL
  -- Equipment for Beverage Station
  SELECT id, 'Espresso Machine', 'Available' FROM kitchen_stations WHERE station_name = 'Beverage Station'
  UNION ALL
  SELECT id, 'Blender', 'Available' FROM kitchen_stations WHERE station_name = 'Beverage Station'
  UNION ALL
  SELECT id, 'Ice Machine', 'Available' FROM kitchen_stations WHERE station_name = 'Beverage Station'

  UNION ALL
  -- Equipment for Appetizer Prep
  SELECT id, 'Food Processor', 'Available' FROM kitchen_stations WHERE station_name = 'Appetizer Prep'
  UNION ALL
  SELECT id, 'Mixing Bowls Set', 'Available' FROM kitchen_stations WHERE station_name = 'Appetizer Prep'
  UNION ALL
  SELECT id, 'Measuring Cups', 'Available' FROM kitchen_stations WHERE station_name = 'Appetizer Prep'
) eq
JOIN kitchen_stations ks ON eq.station_id = ks.id
JOIN inventory_items ii ON ii.name = eq.item_name
WHERE NOT EXISTS (
  SELECT 1 FROM kitchen_station_inventory ksi
  WHERE ksi.station_id = ks.id AND ksi.inventory_item_id = ii.id
);

