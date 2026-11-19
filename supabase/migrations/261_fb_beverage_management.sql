-- F&B Beverage Management Tables
-- Focuses on Wine List and Beverage Categories
-- Leverages existing menu_items and bar_recipes tables

-- Wine List (detailed wine information)
CREATE TABLE IF NOT EXISTS fb_wine_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  wine_type TEXT NOT NULL CHECK (wine_type IN ('Red', 'White', 'Rose', 'Sparkling', 'Dessert', 'Fortified')),
  vintage INTEGER,
  region TEXT,
  country TEXT,
  producer TEXT,
  grape_variety TEXT, -- e.g., "Cabernet Sauvignon", "Chardonnay"
  alcohol_content NUMERIC, -- percentage
  serving_temperature TEXT, -- e.g., "Chilled", "Room Temperature"
  glass_type TEXT, -- e.g., "Red Wine Glass", "White Wine Glass", "Flute"
  pairing_notes TEXT,
  is_by_the_glass BOOLEAN NOT NULL DEFAULT false,
  bottle_price NUMERIC,
  glass_price NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Beverage Menu Categories (categorizes menu items for bar menus)
CREATE TABLE IF NOT EXISTS fb_beverage_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Beverage Menu Item Categorization (links menu items to beverage categories)
CREATE TABLE IF NOT EXISTS fb_beverage_menu_item_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  beverage_category_id UUID NOT NULL REFERENCES fb_beverage_categories(id) ON DELETE CASCADE,
  outlet_id TEXT REFERENCES outlets(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fb_wine_list_item ON fb_wine_list(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_fb_wine_list_type ON fb_wine_list(wine_type);
CREATE INDEX IF NOT EXISTS idx_fb_wine_list_active ON fb_wine_list(is_active);
CREATE INDEX IF NOT EXISTS idx_fb_beverage_categories_active ON fb_beverage_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_fb_beverage_menu_item_categories_item ON fb_beverage_menu_item_categories(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_fb_beverage_menu_item_categories_category ON fb_beverage_menu_item_categories(beverage_category_id);
CREATE INDEX IF NOT EXISTS idx_fb_beverage_menu_item_categories_outlet ON fb_beverage_menu_item_categories(outlet_id);

-- RLS Policies
ALTER TABLE fb_wine_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_beverage_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_beverage_menu_item_categories ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on fb_wine_list" ON fb_wine_list
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_beverage_categories" ON fb_beverage_categories
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_beverage_menu_item_categories" ON fb_beverage_menu_item_categories
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated read access
CREATE POLICY "Authenticated read on fb_wine_list" ON fb_wine_list
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_beverage_categories" ON fb_beverage_categories
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_beverage_menu_item_categories" ON fb_beverage_menu_item_categories
  FOR SELECT USING (auth.role() = 'authenticated');