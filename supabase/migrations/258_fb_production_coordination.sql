-- Production Coordination Tables for F&B Portal
-- Covers KDS Integration, Production Planning, Prep Planning, Batch Production, Kitchen Communication

-- KDS Stations
CREATE TABLE IF NOT EXISTS fb_kds_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('Online', 'Offline', 'Maintenance')),
  open_tickets INTEGER DEFAULT 0,
  avg_ticket_time TEXT, -- e.g., "12 min"
  load INTEGER DEFAULT 0 CHECK (load >= 0 AND load <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- KDS Tickets
CREATE TABLE IF NOT EXISTS fb_kds_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  station_id UUID NOT NULL REFERENCES fb_kds_stations(id) ON DELETE CASCADE,
  items INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Queued', 'In Progress', 'Ready', 'Served')),
  age TEXT, -- e.g., "4 min"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Production Plans
CREATE TABLE IF NOT EXISTS fb_production_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  meal_period TEXT NOT NULL CHECK (meal_period IN ('Breakfast', 'Lunch', 'Dinner', 'All Day')),
  forecast_covers INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Planned', 'In Progress', 'Completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prep Items
CREATE TABLE IF NOT EXISTS fb_prep_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  station TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  assignee TEXT NOT NULL,
  due_by TEXT NOT NULL, -- e.g., "16:00"
  status TEXT NOT NULL CHECK (status IN ('Pending', 'In Progress', 'Ready')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch Production
CREATE TABLE IF NOT EXISTS fb_batch_production (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  batch_type TEXT NOT NULL CHECK (batch_type IN ('Soup', 'Sauce', 'Stock', 'Dough', 'Marinade', 'Dessert Base')),
  yield_qty NUMERIC NOT NULL,
  yield_unit TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Scheduled', 'Cooking', 'Ready', 'Used')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kitchen Messages
CREATE TABLE IF NOT EXISTS fb_kitchen_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_station TEXT NOT NULL,
  to_station TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Info', 'Urgent')),
  message_time TEXT NOT NULL, -- e.g., "20:31"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_fb_kds_stations_outlet ON fb_kds_stations(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_kds_stations_status ON fb_kds_stations(status);
CREATE INDEX IF NOT EXISTS idx_fb_kds_tickets_outlet ON fb_kds_tickets(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_kds_tickets_station ON fb_kds_tickets(station_id);
CREATE INDEX IF NOT EXISTS idx_fb_kds_tickets_status ON fb_kds_tickets(status);
CREATE INDEX IF NOT EXISTS idx_fb_production_plans_outlet ON fb_production_plans(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_production_plans_date ON fb_production_plans(plan_date);
CREATE INDEX IF NOT EXISTS idx_fb_prep_items_outlet ON fb_prep_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_prep_items_status ON fb_prep_items(status);
CREATE INDEX IF NOT EXISTS idx_fb_batch_production_outlet ON fb_batch_production(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_batch_production_status ON fb_batch_production(status);
CREATE INDEX IF NOT EXISTS idx_fb_kitchen_messages_priority ON fb_kitchen_messages(priority);

-- RLS Policies
ALTER TABLE fb_kds_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_kds_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_production_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_prep_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_batch_production ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_kitchen_messages ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on fb_kds_stations" ON fb_kds_stations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_kds_tickets" ON fb_kds_tickets
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_production_plans" ON fb_production_plans
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_prep_items" ON fb_prep_items
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_batch_production" ON fb_batch_production
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on fb_kitchen_messages" ON fb_kitchen_messages
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated read access
CREATE POLICY "Authenticated read on fb_kds_stations" ON fb_kds_stations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_kds_tickets" ON fb_kds_tickets
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_production_plans" ON fb_production_plans
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_prep_items" ON fb_prep_items
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_batch_production" ON fb_batch_production
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on fb_kitchen_messages" ON fb_kitchen_messages
  FOR SELECT USING (auth.role() = 'authenticated');