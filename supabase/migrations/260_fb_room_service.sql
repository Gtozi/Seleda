-- F&B Room Service Tables
-- Focuses on Menu, Orders, Delivery, Minibar, and Guest Preferences for Room Service
-- Per spec §14 (Room Service)

-- Room Service Menu Items (menu items available for room service)
CREATE TABLE IF NOT EXISTS fb_room_service_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  is_available_24h BOOLEAN NOT NULL DEFAULT false,
  available_from TIME,
  available_until TIME,
  availability_days TEXT[], -- e.g., ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room Service Orders (specific room service orders)
CREATE TABLE IF NOT EXISTS fb_room_service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  room_number TEXT NOT NULL,
  guest_name TEXT,
  guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('Immediate', 'Scheduled')),
  scheduled_for TIMESTAMPTZ,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  special_instructions TEXT,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'In Progress', 'Ready', 'Delivered', 'Cancelled')),
  charge_to_room BOOLEAN NOT NULL DEFAULT true,
  folio_id TEXT REFERENCES folios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room Service Order Items
CREATE TABLE IF NOT EXISTS fb_room_service_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_service_order_id UUID NOT NULL REFERENCES fb_room_service_orders(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  special_instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room Service Deliveries (delivery tracking)
CREATE TABLE IF NOT EXISTS fb_room_service_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_service_order_id UUID NOT NULL REFERENCES fb_room_service_orders(id) ON DELETE CASCADE,
  assigned_to TEXT, -- staff member name or ID
  status TEXT NOT NULL CHECK (status IN ('Assigned', 'Picked Up', 'In Transit', 'Delivered', 'Collected')),
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  delivery_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Room Service Guest Preferences (guest preferences for room service)
CREATE TABLE IF NOT EXISTS fb_room_service_guest_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id TEXT REFERENCES guests(id) ON DELETE CASCADE,
  room_number TEXT,
  dietary_restrictions TEXT[], -- e.g., ['Vegetarian', 'Gluten-Free', 'No Nuts']
  preferred_temperature TEXT, -- e.g., 'Hot', 'Warm', 'Room Temperature'
  special_requests TEXT,
  favorite_items TEXT[], -- menu item IDs
  disliked_items TEXT[], -- menu item IDs
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Minibar Inventory (minibar items per room)
CREATE TABLE IF NOT EXISTS fb_minibar_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number TEXT NOT NULL,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  current_stock INTEGER NOT NULL DEFAULT 0,
  max_stock INTEGER NOT NULL DEFAULT 5,
  last_restocked_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Minibar Consumption (minibar consumption tracking)
CREATE TABLE IF NOT EXISTS fb_minibar_consumption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number TEXT NOT NULL,
  guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ DEFAULT NOW(),
  charged_to_folio BOOLEAN NOT NULL DEFAULT false,
  folio_id TEXT REFERENCES folios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fb_room_service_menu_items_outlet ON fb_room_service_menu_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_menu_items_active ON fb_room_service_menu_items(is_active);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_orders_room ON fb_room_service_orders(room_number);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_orders_status ON fb_room_service_orders(status);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_orders_guest ON fb_room_service_orders(guest_id);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_order_items_order ON fb_room_service_order_items(room_service_order_id);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_deliveries_order ON fb_room_service_deliveries(room_service_order_id);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_deliveries_status ON fb_room_service_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_guest_preferences_guest ON fb_room_service_guest_preferences(guest_id);
CREATE INDEX IF NOT EXISTS idx_fb_room_service_guest_preferences_room ON fb_room_service_guest_preferences(room_number);
CREATE INDEX IF NOT EXISTS idx_fb_minibar_inventory_room ON fb_minibar_inventory(room_number);
CREATE INDEX IF NOT EXISTS idx_fb_minibar_consumption_room ON fb_minibar_consumption(room_number);
CREATE INDEX IF NOT EXISTS idx_fb_minibar_consumption_guest ON fb_minibar_consumption(guest_id);

-- RLS Policies
ALTER TABLE fb_room_service_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_room_service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_room_service_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_room_service_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_room_service_guest_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_minibar_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_minibar_consumption ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on fb_room_service_menu_items" ON fb_room_service_menu_items
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_room_service_orders" ON fb_room_service_orders
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_room_service_order_items" ON fb_room_service_order_items
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_room_service_deliveries" ON fb_room_service_deliveries
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_room_service_guest_preferences" ON fb_room_service_guest_preferences
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_minibar_inventory" ON fb_minibar_inventory
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_minibar_consumption" ON fb_minibar_consumption
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated read access
CREATE POLICY "Authenticated read on fb_room_service_menu_items" ON fb_room_service_menu_items
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_room_service_orders" ON fb_room_service_orders
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_room_service_order_items" ON fb_room_service_order_items
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_room_service_deliveries" ON fb_room_service_deliveries
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_room_service_guest_preferences" ON fb_room_service_guest_preferences
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_minibar_inventory" ON fb_minibar_inventory
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_minibar_consumption" ON fb_minibar_consumption
  FOR SELECT USING (auth.role() = 'authenticated');