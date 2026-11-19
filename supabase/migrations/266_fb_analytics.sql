-- Migration: F&B Analytics
-- Backs the /erp/fb/analytics screen. Pre-aggregated snapshot tables for
-- Outlet, Menu, Kitchen, and Cost analytics. Each table has a `period` column
-- ('Today', 'MTD', 'YTD') so the period toggle in the UI can fetch the right
-- snapshot. References outlets(id) and menu_items(id).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Outlet map:
--   MAIN (Main Restaurant) = 8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f
--   La Maison              = 8ad72723-fb18-43b2-9333-6cc6f709f749
--   Sky Lounge Bar         = 907e8a05-57f7-4159-81d3-ad53a1745fa3
--   Room Service           = 4a3f6574-bde9-47e4-bf8d-1b0c64ca6841

-- ── fb_outlet_analytics ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_outlet_analytics (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  period TEXT NOT NULL CHECK (period IN ('Today','MTD','YTD')),
  revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  covers INTEGER NOT NULL DEFAULT 0,
  avg_check NUMERIC(18,2) NOT NULL DEFAULT 0,
  rev_pash NUMERIC(18,2) NOT NULL DEFAULT 0,
  occupancy NUMERIC(5,2) NOT NULL DEFAULT 0,
  turnover NUMERIC(5,2) NOT NULL DEFAULT 0,
  change_percent NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_outlet_analytics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_outlet_analytics_outlet ON fb_outlet_analytics(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_outlet_analytics_period ON fb_outlet_analytics(period);

-- ── fb_menu_engineering ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_menu_engineering (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  menu_item_id TEXT,
  outlet_id TEXT,
  period TEXT NOT NULL CHECK (period IN ('Today','MTD','YTD')),
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  sold INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(18,2) NOT NULL DEFAULT 0,
  cost NUMERIC(18,2) NOT NULL DEFAULT 0,
  margin NUMERIC(18,2) NOT NULL DEFAULT 0,
  food_cost_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT 'Dog' CHECK (classification IN ('Star','Plow Horse','Puzzle','Dog')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_menu_engineering ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_menu_engineering_outlet ON fb_menu_engineering(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_menu_engineering_period ON fb_menu_engineering(period);
CREATE INDEX IF NOT EXISTS idx_fb_menu_engineering_item ON fb_menu_engineering(menu_item_id);

-- ── fb_kitchen_analytics ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_kitchen_analytics (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  period TEXT NOT NULL CHECK (period IN ('Today','MTD','YTD')),
  station TEXT NOT NULL,
  avg_ticket_time_min NUMERIC(8,2) NOT NULL DEFAULT 0,
  volume INTEGER NOT NULL DEFAULT 0,
  accuracy NUMERIC(5,2) NOT NULL DEFAULT 0,
  downtime_min INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_kitchen_analytics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_kitchen_analytics_outlet ON fb_kitchen_analytics(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_kitchen_analytics_period ON fb_kitchen_analytics(period);

-- ── fb_cost_analytics ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_cost_analytics (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  outlet_id TEXT,
  period TEXT NOT NULL CHECK (period IN ('Today','MTD','YTD')),
  food_cost_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
  bev_cost_pct NUMERIC(8,2) NOT NULL DEFAULT 0,
  waste NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance NUMERIC(8,2) NOT NULL DEFAULT 0,
  theoretical NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);
ALTER TABLE fb_cost_analytics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_cost_analytics_outlet ON fb_cost_analytics(outlet_id);
CREATE INDEX IF NOT EXISTS idx_fb_cost_analytics_period ON fb_cost_analytics(period);

-- ── Foreign keys to outlets(id) ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_outlet_analytics_outlet_id_fkey') THEN
    ALTER TABLE fb_outlet_analytics ADD CONSTRAINT fb_outlet_analytics_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_menu_engineering_outlet_id_fkey') THEN
    ALTER TABLE fb_menu_engineering ADD CONSTRAINT fb_menu_engineering_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_menu_engineering_menu_item_id_fkey') THEN
    ALTER TABLE fb_menu_engineering ADD CONSTRAINT fb_menu_engineering_menu_item_id_fkey
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_kitchen_analytics_outlet_id_fkey') THEN
    ALTER TABLE fb_kitchen_analytics ADD CONSTRAINT fb_kitchen_analytics_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fb_cost_analytics_outlet_id_fkey') THEN
    ALTER TABLE fb_cost_analytics ADD CONSTRAINT fb_cost_analytics_outlet_id_fkey
      FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Permission ─────────────────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
SELECT 'perm_fb_analytics_view', 'fb:analytics:view', 'fnb',
       'View F&B analytics (outlet, menu, kitchen, cost)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'fb:analytics:view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fb:analytics:view'
WHERE r.name IN ('admin','super_admin','executive','general_manager','owner','fb_manager','finance_controller','cfo','operations_manager')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ════════════════════════════════════════════════════════════════════
-- SEED DATA — 3 periods (Today, MTD, YTD) for all 4 tables
-- ════════════════════════════════════════════════════════════════════

-- ── Outlet Analytics ───────────────────────────────────────────────
INSERT INTO fb_outlet_analytics (outlet_id, period, revenue, covers, avg_check, rev_pash, occupancy, turnover, change_percent)
SELECT * FROM (VALUES
  -- MTD (default period)
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'MTD'::text,24500.00,280,87.50,182.00,74.00,2.40,4.20),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','MTD',18900.00,95,198.90,236.00,82.00,1.60,6.10),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','MTD',12400.00,210,59.00,145.00,68.00,3.20,-1.40),
  ('4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','MTD',6800.00,145,46.90,0.00,0.00,0.00,2.80),
  -- Today
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Today',8500.00,120,70.83,185.00,78.00,2.50,5.10),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','Today',6200.00,32,193.75,240.00,85.00,1.70,7.20),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','Today',3200.00,80,40.00,148.00,72.00,3.40,0.80),
  ('4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Today',1800.00,25,72.00,0.00,0.00,0.00,3.50),
  -- YTD
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','YTD',285000.00,3200,89.06,180.00,72.00,2.30,8.50),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','YTD',215000.00,1100,195.45,232.00,80.00,1.55,12.30),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','YTD',148000.00,2400,61.67,142.00,65.00,3.10,4.20),
  ('4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','YTD',78000.00,1600,48.75,0.00,0.00,0.00,6.40)
) AS t(outlet_id,period,revenue,covers,avg_check,rev_pash,occupancy,turnover,change_percent)
WHERE NOT EXISTS (SELECT 1 FROM fb_outlet_analytics WHERE outlet_id = t.outlet_id AND period = t.period);

-- ── Menu Engineering ───────────────────────────────────────────────
INSERT INTO fb_menu_engineering (menu_item_id, outlet_id, period, item_name, category, sold, price, cost, margin, food_cost_pct, classification)
SELECT * FROM (VALUES
  -- MTD
  ('709cc913-6617-4bd6-8d9a-a9d3bba65fad'::text,'8ad72723-fb18-43b2-9333-6cc6f709f749'::text,'MTD'::text,'Margherita Pizza'::text,'Main Course'::text,128,16.80,4.20,12.60,25.00,'Star'::text),
  ('ade88a31-1d3b-4ae9-ba74-4300dd0e3291','8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Caesar Salad','Appetizer',96,11.07,3.10,7.97,28.00,'Plow Horse'),
  ('c1056bde-d44f-4277-a7a4-fd7fa6b3d4e6','8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Grilled Salmon','Main Course',54,30.62,9.80,20.82,32.01,'Puzzle'),
  ('bb7242f9-2e15-4e41-baaf-f25aa61992d3','8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Tiramisu','Dessert',82,9.23,2.40,6.83,26.00,'Star'),
  ('f38bd62a-71cd-4e36-87f9-2b8b836d475f','907e8a05-57f7-4159-81d3-ad53a1745fa3','MTD','Old Fashioned','Cocktail',145,16.00,3.50,12.50,21.88,'Star'),
  ('66c0f1aa-a2ab-4e9e-a96f-d5f55b2aa8e8','8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','French Onion Soup','Appetizer',34,8.50,4.50,4.00,52.94,'Dog'),
  ('e2ddb2e0-b548-4768-aa26-7a6c360f98a8','8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Beef Tenderloin','Main Course',42,42.00,16.80,25.20,40.00,'Puzzle'),
  ('20a9a4a7-614c-4e3b-b72d-f6876034adfe','907e8a05-57f7-4159-81d3-ad53a1745fa3','MTD','Classic Mojito','Cocktail',112,14.00,3.20,10.80,22.86,'Star'),
  ('cc1d4814-0cea-4c35-a1db-9fb6966da01f','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','MTD','Club Sandwich','Main Course',68,12.00,3.80,8.20,31.67,'Plow Horse'),
  ('33fd168d-4fd9-47a4-8642-4a480bc118e9','907e8a05-57f7-4159-81d3-ad53a1745fa3','MTD','Calamari Fritti','Bar Bites',89,13.50,4.20,9.30,31.11,'Plow Horse'),
  -- Today
  ('709cc913-6617-4bd6-8d9a-a9d3bba65fad','8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Margherita Pizza','Main Course',18,16.80,4.20,12.60,25.00,'Star'),
  ('ade88a31-1d3b-4ae9-ba74-4300dd0e3291','8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Caesar Salad','Appetizer',12,11.07,3.10,7.97,28.00,'Plow Horse'),
  ('c1056bde-d44f-4277-a7a4-fd7fa6b3d4e6','8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Grilled Salmon','Main Course',6,30.62,9.80,20.82,32.01,'Puzzle'),
  ('bb7242f9-2e15-4e41-baaf-f25aa61992d3','8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Tiramisu','Dessert',9,9.23,2.40,6.83,26.00,'Star'),
  ('f38bd62a-71cd-4e36-87f9-2b8b836d475f','907e8a05-57f7-4159-81d3-ad53a1745fa3','Today','Old Fashioned','Cocktail',22,16.00,3.50,12.50,21.88,'Star'),
  ('66c0f1aa-a2ab-4e9e-a96f-d5f55b2aa8e8','8ad72723-fb18-43b2-9333-6cc6f709f749','Today','French Onion Soup','Appetizer',4,8.50,4.50,4.00,52.94,'Dog'),
  ('e2ddb2e0-b548-4768-aa26-7a6c360f98a8','8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Beef Tenderloin','Main Course',5,42.00,16.80,25.20,40.00,'Puzzle'),
  ('20a9a4a7-614c-4e3b-b72d-f6876034adfe','907e8a05-57f7-4159-81d3-ad53a1745fa3','Today','Classic Mojito','Cocktail',16,14.00,3.20,10.80,22.86,'Star'),
  ('cc1d4814-0cea-4c35-a1db-9fb6966da01f','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Today','Club Sandwich','Main Course',8,12.00,3.80,8.20,31.67,'Plow Horse'),
  ('33fd168d-4fd9-47a4-8642-4a480bc118e9','907e8a05-57f7-4159-81d3-ad53a1745fa3','Today','Calamari Fritti','Bar Bites',12,13.50,4.20,9.30,31.11,'Plow Horse'),
  -- YTD
  ('709cc913-6617-4bd6-8d9a-a9d3bba65fad','8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Margherita Pizza','Main Course',1480,16.80,4.20,12.60,25.00,'Star'),
  ('ade88a31-1d3b-4ae9-ba74-4300dd0e3291','8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Caesar Salad','Appetizer',1120,11.07,3.10,7.97,28.00,'Plow Horse'),
  ('c1056bde-d44f-4277-a7a4-fd7fa6b3d4e6','8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Grilled Salmon','Main Course',640,30.62,9.80,20.82,32.01,'Puzzle'),
  ('bb7242f9-2e15-4e41-baaf-f25aa61992d3','8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Tiramisu','Dessert',950,9.23,2.40,6.83,26.00,'Star'),
  ('f38bd62a-71cd-4e36-87f9-2b8b836d475f','907e8a05-57f7-4159-81d3-ad53a1745fa3','YTD','Old Fashioned','Cocktail',1680,16.00,3.50,12.50,21.88,'Star'),
  ('66c0f1aa-a2ab-4e9e-a96f-d5f55b2aa8e8','8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','French Onion Soup','Appetizer',390,8.50,4.50,4.00,52.94,'Dog'),
  ('e2ddb2e0-b548-4768-aa26-7a6c360f98a8','8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Beef Tenderloin','Main Course',490,42.00,16.80,25.20,40.00,'Puzzle'),
  ('20a9a4a7-614c-4e3b-b72d-f6876034adfe','907e8a05-57f7-4159-81d3-ad53a1745fa3','YTD','Classic Mojito','Cocktail',1300,14.00,3.20,10.80,22.86,'Star'),
  ('cc1d4814-0cea-4c35-a1db-9fb6966da01f','4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','YTD','Club Sandwich','Main Course',790,12.00,3.80,8.20,31.67,'Plow Horse'),
  ('33fd168d-4fd9-47a4-8642-4a480bc118e9','907e8a05-57f7-4159-81d3-ad53a1745fa3','YTD','Calamari Fritti','Bar Bites',1020,13.50,4.20,9.30,31.11,'Plow Horse')
) AS t(menu_item_id,outlet_id,period,item_name,category,sold,price,cost,margin,food_cost_pct,classification)
WHERE NOT EXISTS (SELECT 1 FROM fb_menu_engineering WHERE menu_item_id = t.menu_item_id AND period = t.period);

-- ── Kitchen Analytics ──────────────────────────────────────────────
INSERT INTO fb_kitchen_analytics (outlet_id, period, station, avg_ticket_time_min, volume, accuracy, downtime_min)
SELECT * FROM (VALUES
  -- MTD (Main Restaurant + La Maison stations)
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'MTD'::text,'Grill'::text,14.00,184,94.00,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','MTD','Fry',9.00,96,96.50,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','MTD','Cold',5.00,142,98.10,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','MTD','Pizza',12.00,128,97.20,0),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Pastry',4.00,88,99.00,40),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Saute',11.00,156,95.30,10),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','MTD','Garde Manger',6.00,72,97.80,0),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','MTD','Bar',4.00,210,98.50,0),
  -- Today
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Today','Grill',13.50,28,95.00,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Today','Fry',8.50,14,97.00,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Today','Cold',4.80,22,98.50,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Today','Pizza',11.50,20,97.50,0),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Pastry',3.80,12,99.20,0),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Saute',10.50,24,96.00,0),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','Today','Garde Manger',5.50,10,98.00,0),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','Today','Bar',3.80,32,98.80,0),
  -- YTD
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','YTD','Grill',14.20,2100,93.80,120),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','YTD','Fry',9.10,1100,96.30,30),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','YTD','Cold',5.10,1600,98.00,0),
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','YTD','Pizza',12.10,1450,97.10,45),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Pastry',4.10,980,98.90,380),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Saute',11.20,1800,95.10,95),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','YTD','Garde Manger',6.10,820,97.70,15),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','YTD','Bar',4.00,2400,98.40,0)
) AS t(outlet_id,period,station,avg_ticket_time_min,volume,accuracy,downtime_min)
WHERE NOT EXISTS (SELECT 1 FROM fb_kitchen_analytics WHERE outlet_id = t.outlet_id AND period = t.period AND station = t.station);

-- ── Cost Analytics ─────────────────────────────────────────────────
INSERT INTO fb_cost_analytics (outlet_id, period, food_cost_pct, bev_cost_pct, waste, variance, theoretical, actual)
SELECT * FROM (VALUES
  -- MTD
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text,'MTD'::text,28.40,22.10,320.00,2.80,6920.00,7110.00),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','MTD',32.50,26.00,180.00,1.40,6140.00,6226.00),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','MTD',24.00,18.50,210.00,3.20,2970.00,3065.00),
  ('4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','MTD',31.00,20.00,95.00,2.10,2100.00,2144.00),
  -- Today
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','Today',27.80,21.50,45.00,2.10,2380.00,2430.00),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','Today',31.80,25.40,28.00,1.10,1970.00,1992.00),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','Today',23.50,18.00,32.00,2.80,760.00,781.00),
  ('4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','Today',30.40,19.50,15.00,1.80,560.00,570.00),
  -- YTD
  ('8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f','YTD',29.10,22.50,3680.00,3.10,80500.00,83000.00),
  ('8ad72723-fb18-43b2-9333-6cc6f709f749','YTD',33.00,26.50,2100.00,1.60,71000.00,72140.00),
  ('907e8a05-57f7-4159-81d3-ad53a1745fa3','YTD',24.50,18.80,2480.00,3.50,35400.00,36640.00),
  ('4a3f6574-bde9-47e4-bf8d-1b0c64ca6841','YTD',31.50,20.20,1120.00,2.30,24600.00,25170.00)
) AS t(outlet_id,period,food_cost_pct,bev_cost_pct,waste,variance,theoretical,actual)
WHERE NOT EXISTS (SELECT 1 FROM fb_cost_analytics WHERE outlet_id = t.outlet_id AND period = t.period);
