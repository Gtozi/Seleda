-- F&B Banquet Management Tables
-- Focuses on Menu, Recipe, Production Requirements, Beverage Requirements for Banquets
-- Separate from Banquet Portal which manages Event/Client/Venue/BEO/Event timeline

-- Banquet Menus (menu templates for banquets)
CREATE TABLE IF NOT EXISTS fb_banquet_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  menu_type TEXT NOT NULL CHECK (menu_type IN ('Wedding', 'Corporate', 'Conference', 'Birthday', 'Social', 'Custom')),
  price_per_person NUMERIC NOT NULL DEFAULT 0,
  min_guests INTEGER NOT NULL DEFAULT 1,
  max_guests INTEGER,
  courses JSONB, -- e.g., ["Appetizers", "Main Course", "Dessert"]
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Menu Items (items within banquet menus)
CREATE TABLE IF NOT EXISTS fb_banquet_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banquet_menu_id UUID NOT NULL REFERENCES fb_banquet_menus(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  course TEXT NOT NULL, -- e.g., "Appetizers", "Main Course"
  sequence INTEGER NOT NULL DEFAULT 0,
  quantity_per_person NUMERIC NOT NULL DEFAULT 1,
  is_optional BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Packages (pre-configured banquet food & beverage packages)
CREATE TABLE IF NOT EXISTS fb_banquet_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  package_type TEXT NOT NULL CHECK (package_type IN ('All-Inclusive', 'Food Only', 'Beverage Only', 'Premium', 'Standard', 'Budget')),
  price_per_person NUMERIC NOT NULL DEFAULT 0,
  min_guests INTEGER NOT NULL DEFAULT 1,
  max_guests INTEGER,
  includes_food BOOLEAN NOT NULL DEFAULT true,
  includes_beverage BOOLEAN NOT NULL DEFAULT true,
  includes_service BOOLEAN NOT NULL DEFAULT true,
  inclusions JSONB, -- e.g., {"setup": true, "linens": true, "decor": false}
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Package Components (items in packages)
CREATE TABLE IF NOT EXISTS fb_banquet_package_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES fb_banquet_packages(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  component_type TEXT NOT NULL CHECK (component_type IN ('Food', 'Beverage', 'Service', 'Equipment')),
  quantity_per_person NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Package Outlet Availability
CREATE TABLE IF NOT EXISTS fb_banquet_package_outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES fb_banquet_packages(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Production Requirements (production requirements per event)
CREATE TABLE IF NOT EXISTS fb_banquet_production_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banquet_event_id TEXT, -- Reference to banquet_events table (no FK to avoid circular dependency)
  menu_id UUID REFERENCES fb_banquet_menus(id) ON DELETE SET NULL,
  preparation_area TEXT NOT NULL, -- e.g., "Main Kitchen", "Pastry", "Cold Kitchen"
  prep_start_hours_before INTEGER NOT NULL DEFAULT 0, -- Hours before event start
  prep_duration_minutes INTEGER NOT NULL DEFAULT 0,
  staff_count INTEGER NOT NULL DEFAULT 0,
  equipment_needed JSONB, -- e.g., {"ovens": 2, "chafing_dishes": 10}
  special_instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Production Menu Items
CREATE TABLE IF NOT EXISTS fb_banquet_production_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_requirement_id UUID NOT NULL REFERENCES fb_banquet_production_requirements(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity_per_guest NUMERIC NOT NULL DEFAULT 1,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  prep_status TEXT NOT NULL CHECK (prep_status IN ('Pending', 'In Progress', 'Ready', 'Completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Beverage Requirements (beverage requirements per event)
CREATE TABLE IF NOT EXISTS fb_banquet_beverage_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banquet_event_id TEXT, -- Reference to banquet_events table
  beverage_package_id UUID REFERENCES fb_banquet_packages(id) ON DELETE SET NULL,
  bar_setup_type TEXT NOT NULL CHECK (bar_setup_type IN ('Full Bar', 'Beer & Wine Only', 'Signature Cocktails', 'Non-Alcoholic', 'Custom')),
  bartender_count INTEGER NOT NULL DEFAULT 0,
  bar_start_hours_before INTEGER NOT NULL DEFAULT 1,
  special_drinks JSONB, -- e.g., [{"name": "Wedding Cocktail", "quantity": 100}]
  glassware_needed JSONB, -- e.g., {"wine_glasses": 200, "champagne_flutes": 150}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banquet Beverage Items
CREATE TABLE IF NOT EXISTS fb_banquet_beverage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beverage_requirement_id UUID NOT NULL REFERENCES fb_banquet_beverage_requirements(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity_per_guest NUMERIC NOT NULL DEFAULT 1,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fb_banquet_menus_type ON fb_banquet_menus(menu_type);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_menus_active ON fb_banquet_menus(is_active);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_menu_items_menu ON fb_banquet_menu_items(banquet_menu_id);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_packages_type ON fb_banquet_packages(package_type);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_packages_active ON fb_banquet_packages(is_active);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_package_components_package ON fb_banquet_package_components(package_id);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_package_outlets_package ON fb_banquet_package_outlets(package_id);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_production_event ON fb_banquet_production_requirements(banquet_event_id);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_production_menu_req ON fb_banquet_production_menu_items(production_requirement_id);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_beverage_event ON fb_banquet_beverage_requirements(banquet_event_id);
CREATE INDEX IF NOT EXISTS idx_fb_banquet_beverage_items_req ON fb_banquet_beverage_items(beverage_requirement_id);

-- RLS Policies
ALTER TABLE fb_banquet_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_package_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_package_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_production_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_production_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_beverage_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_banquet_beverage_items ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on fb_banquet_menus" ON fb_banquet_menus
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_menu_items" ON fb_banquet_menu_items
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_packages" ON fb_banquet_packages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_package_components" ON fb_banquet_package_components
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_package_outlets" ON fb_banquet_package_outlets
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_production_requirements" ON fb_banquet_production_requirements
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_production_menu_items" ON fb_banquet_production_menu_items
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_beverage_requirements" ON fb_banquet_beverage_requirements
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_banquet_beverage_items" ON fb_banquet_beverage_items
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated read access
CREATE POLICY "Authenticated read on fb_banquet_menus" ON fb_banquet_menus
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_menu_items" ON fb_banquet_menu_items
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_packages" ON fb_banquet_packages
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_package_components" ON fb_banquet_package_components
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_package_outlets" ON fb_banquet_package_outlets
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_production_requirements" ON fb_banquet_production_requirements
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_production_menu_items" ON fb_banquet_production_menu_items
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_beverage_requirements" ON fb_banquet_beverage_requirements
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_banquet_beverage_items" ON fb_banquet_beverage_items
  FOR SELECT USING (auth.role() = 'authenticated');