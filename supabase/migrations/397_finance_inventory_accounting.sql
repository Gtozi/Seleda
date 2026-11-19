-- ============================================================
-- Finance — Inventory Accounting: valuation, COGS, adjustments,
-- write-offs, and revaluation tables + seed data
-- (Migration 397)
-- ============================================================
-- Brings the /erp/finance/inventory tab fully online:
--   • fin_inventory_valuation   — inventory valuation snapshot
--   • fin_cogs_entries          — cost-of-goods-sold entries
--   • fin_inventory_adjustments — inventory adjustments (qty/value)
--   • fin_stock_writeoffs       — stock write-offs with approval flow
--   • fin_stock_revaluations    — stock revaluations with approval flow
-- All tables are property-scoped, RLS-enabled, and seeded with demo
-- rows so the tab has data on a fresh DB.
-- ============================================================

-- Demo property used across the ERP
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fin_valuation_method') THEN
    CREATE TYPE public.fin_valuation_method AS ENUM ('fifo', 'lifo', 'weighted_average');
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. fin_inventory_valuation
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_inventory_valuation (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_code text,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  valuation_method text NOT NULL DEFAULT 'weighted_average' CHECK (valuation_method IN ('fifo','lifo','weighted_average')),
  last_revalued date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_inv_valuation_property ON public.fin_inventory_valuation(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_inv_valuation_category ON public.fin_inventory_valuation(category);

ALTER TABLE public.fin_inventory_valuation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_inventory_valuation" ON public.fin_inventory_valuation;
CREATE POLICY "authenticated can CRUD fin_inventory_valuation" ON public.fin_inventory_valuation
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_inventory_valuation" ON public.fin_inventory_valuation;
CREATE POLICY "service_role all fin_inventory_valuation" ON public.fin_inventory_valuation
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_inventory_valuation TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_cogs_entries
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_cogs_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  department text NOT NULL DEFAULT 'General',
  item_category text NOT NULL DEFAULT 'General',
  item_name text,
  quantity_used numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cogs numeric NOT NULL DEFAULT 0,
  reference text,
  period text NOT NULL DEFAULT to_char(now(), 'YYYY-MM'),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_cogs_property ON public.fin_cogs_entries(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_cogs_date ON public.fin_cogs_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_fin_cogs_dept ON public.fin_cogs_entries(department);

ALTER TABLE public.fin_cogs_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_cogs_entries" ON public.fin_cogs_entries;
CREATE POLICY "authenticated can CRUD fin_cogs_entries" ON public.fin_cogs_entries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_cogs_entries" ON public.fin_cogs_entries;
CREATE POLICY "service_role all fin_cogs_entries" ON public.fin_cogs_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_cogs_entries TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_inventory_adjustments
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_inventory_adjustments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  adjustment_number text,
  adjustment_date date NOT NULL DEFAULT CURRENT_DATE,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  adjustment_type text NOT NULL DEFAULT 'quantity' CHECK (adjustment_type IN ('quantity','value','reclassification')),
  old_quantity numeric,
  new_quantity numeric,
  old_unit_cost numeric,
  new_unit_cost numeric,
  value_impact numeric NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Posted')),
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_adj_property ON public.fin_inventory_adjustments(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_adj_status ON public.fin_inventory_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_fin_adj_date ON public.fin_inventory_adjustments(adjustment_date);

ALTER TABLE public.fin_inventory_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_inventory_adjustments" ON public.fin_inventory_adjustments;
CREATE POLICY "authenticated can CRUD fin_inventory_adjustments" ON public.fin_inventory_adjustments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_inventory_adjustments" ON public.fin_inventory_adjustments;
CREATE POLICY "service_role all fin_inventory_adjustments" ON public.fin_inventory_adjustments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_inventory_adjustments TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. fin_stock_writeoffs
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_stock_writeoffs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  writeoff_number text,
  writeoff_date date NOT NULL DEFAULT CURRENT_DATE,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  writeoff_type text NOT NULL DEFAULT 'damage' CHECK (writeoff_type IN ('damage','spoilage','expiry','theft','obsolescence','other')),
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Posted')),
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  gl_posted boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_wo_property ON public.fin_stock_writeoffs(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_wo_status ON public.fin_stock_writeoffs(status);
CREATE INDEX IF NOT EXISTS idx_fin_wo_date ON public.fin_stock_writeoffs(writeoff_date);

ALTER TABLE public.fin_stock_writeoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_stock_writeoffs" ON public.fin_stock_writeoffs;
CREATE POLICY "authenticated can CRUD fin_stock_writeoffs" ON public.fin_stock_writeoffs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_stock_writeoffs" ON public.fin_stock_writeoffs;
CREATE POLICY "service_role all fin_stock_writeoffs" ON public.fin_stock_writeoffs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_stock_writeoffs TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. fin_stock_revaluations
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_stock_revaluations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  revaluation_number text,
  revaluation_date date NOT NULL DEFAULT CURRENT_DATE,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  old_cost numeric NOT NULL DEFAULT 0,
  new_cost numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  old_total_value numeric NOT NULL DEFAULT 0,
  new_total_value numeric NOT NULL DEFAULT 0,
  variance numeric NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Posted')),
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_rev_property ON public.fin_stock_revaluations(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_rev_status ON public.fin_stock_revaluations(status);
CREATE INDEX IF NOT EXISTS idx_fin_rev_date ON public.fin_stock_revaluations(revaluation_date);

ALTER TABLE public.fin_stock_revaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_stock_revaluations" ON public.fin_stock_revaluations;
CREATE POLICY "authenticated can CRUD fin_stock_revaluations" ON public.fin_stock_revaluations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_stock_revaluations" ON public.fin_stock_revaluations;
CREATE POLICY "service_role all fin_stock_revaluations" ON public.fin_stock_revaluations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_stock_revaluations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. Seed data
-- ════════════════════════════════════════════════════════════════
-- Use the demo property for all seed rows
-- '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- fin_inventory_valuation seed
INSERT INTO public.fin_inventory_valuation (property_id, item_code, item_name, category, quantity, unit_cost, total_value, valuation_method, last_revalued) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-001', 'Queen Size Sheets', 'Linens', 60, 750.00, 45000.00, 'weighted_average', '2026-08-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-002', 'King Size Sheets', 'Linens', 45, 850.00, 38250.00, 'weighted_average', '2026-08-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-003', 'Vacuum Cleaner', 'Equipment', 5, 3500.00, 17500.00, 'fifo', '2026-07-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-004', 'Housekeeping Cart', 'Equipment', 8, 1800.00, 14400.00, 'fifo', '2026-07-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-005', 'Laundry Detergent', 'Cleaning Supplies', 50, 180.00, 9000.00, 'weighted_average', '2026-08-10'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-006', 'Bath Towels', 'Linens', 150, 45.00, 6750.00, 'weighted_average', '2026-08-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-007', 'Floor Disinfectant', 'Cleaning Supplies', 30, 200.00, 6000.00, 'weighted_average', '2026-08-10'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-008', 'Iron', 'Equipment', 12, 450.00, 5400.00, 'fifo', '2026-07-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-009', 'Multi-Surface Cleaner', 'Cleaning Supplies', 25.5, 150.00, 3825.00, 'weighted_average', '2026-08-10'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-010', 'Floor Mop', 'Equipment', 15, 250.00, 3750.00, 'fifo', '2026-07-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-011', 'Bathroom Cleaner', 'Cleaning Supplies', 18, 180.00, 3240.00, 'weighted_average', '2026-08-10'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-012', 'Pillowcases', 'Linens', 200, 15.00, 3000.00, 'weighted_average', '2026-08-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-013', 'Hand Towels', 'Linens', 100, 25.00, 2500.00, 'weighted_average', '2026-08-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-014', 'Body Lotion', 'Amenities', 250, 10.00, 2500.00, 'weighted_average', '2026-08-05'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-015', 'Shampoo Bottles', 'Amenities', 300, 8.00, 2400.00, 'weighted_average', '2026-08-05'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-016', 'Wine Inventory - Premium', 'Beverages', 240, 92.50, 22200.00, 'fifo', '2026-06-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-017', 'Food Stock - Dry Goods', 'Food', 850, 13.75, 11687.50, 'weighted_average', '2026-05-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'INV-018', 'Cleaning Supplies Bulk', 'Cleaning Supplies', 320, 7.50, 2400.00, 'lifo', '2026-05-10')
ON CONFLICT DO NOTHING;

-- fin_cogs_entries seed
INSERT INTO public.fin_cogs_entries (property_id, entry_date, department, item_category, item_name, quantity_used, unit_cost, total_cogs, reference, period) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-09-01', 'Food & Beverage', 'Food', 'Food Stock - Dry Goods', 120, 13.75, 1650.00, 'POS-00451', '2026-09'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-09-01', 'Food & Beverage', 'Beverages', 'Wine Inventory - Premium', 18, 92.50, 1665.00, 'POS-00452', '2026-09'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-31', 'Housekeeping', 'Cleaning Supplies', 'Laundry Detergent', 8, 180.00, 1440.00, 'HK-CONS-0831', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-31', 'Housekeeping', 'Cleaning Supplies', 'Floor Disinfectant', 5, 200.00, 1000.00, 'HK-CONS-0831', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-30', 'Food & Beverage', 'Food', 'Food Stock - Dry Goods', 95, 13.75, 1306.25, 'POS-00420', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-30', 'Food & Beverage', 'Beverages', 'Wine Inventory - Premium', 12, 92.50, 1110.00, 'POS-00421', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-29', 'Housekeeping', 'Amenities', 'Body Lotion', 45, 10.00, 450.00, 'HK-CONS-0829', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-29', 'Housekeeping', 'Amenities', 'Shampoo Bottles', 60, 8.00, 480.00, 'HK-CONS-0829', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-28', 'Food & Beverage', 'Food', 'Food Stock - Dry Goods', 110, 13.75, 1512.50, 'POS-00398', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-28', 'Engineering', 'Equipment', 'Floor Mop', 2, 250.00, 500.00, 'ENG-WO-0231', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-25', 'Food & Beverage', 'Beverages', 'Wine Inventory - Premium', 24, 92.50, 2220.00, 'POS-00380', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-20', 'Housekeeping', 'Linens', 'Bath Towels', 30, 45.00, 1350.00, 'HK-CONS-0820', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-15', 'Food & Beverage', 'Food', 'Food Stock - Dry Goods', 85, 13.75, 1168.75, 'POS-00310', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-10', 'Housekeeping', 'Cleaning Supplies', 'Multi-Surface Cleaner', 6, 150.00, 900.00, 'HK-CONS-0810', '2026-08'),
  ('18762279-a389-41c9-9169-7ebc682e9703', '2026-08-05', 'Food & Beverage', 'Beverages', 'Wine Inventory - Premium', 15, 92.50, 1387.50, 'POS-00275', '2026-08')
ON CONFLICT DO NOTHING;

-- fin_inventory_adjustments seed
INSERT INTO public.fin_inventory_adjustments (property_id, adjustment_number, adjustment_date, item_name, category, adjustment_type, old_quantity, new_quantity, old_unit_cost, new_unit_cost, value_impact, reason, status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADJ-001', '2026-09-01', 'Bath Towels', 'Linens', 'quantity', 150, 148, 45.00, 45.00, -90.00, 'Physical count variance — 2 units missing', 'Approved'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADJ-002', '2026-08-28', 'Laundry Detergent', 'Cleaning Supplies', 'quantity', 50, 52, 180.00, 180.00, 360.00, 'Found 2 extra units during stock count', 'Posted'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADJ-003', '2026-08-25', 'Multi-Surface Cleaner', 'Cleaning Supplies', 'value', 25.5, 25.5, 150.00, 165.00, 382.50, 'Supplier price correction', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADJ-004', '2026-08-20', 'Vacuum Cleaner', 'Equipment', 'reclassification', 5, 5, 3500.00, 3500.00, 0, 'Reclassify from consumable to fixed asset', 'Approved'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADJ-005', '2026-08-15', 'Pillowcases', 'Linens', 'quantity', 200, 195, 15.00, 15.00, -75.00, 'Damaged in storage — 5 units', 'Posted'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ADJ-006', '2026-08-10', 'Body Lotion', 'Amenities', 'quantity', 250, 245, 10.00, 10.00, -50.00, 'Expired samples removed', 'Rejected')
ON CONFLICT DO NOTHING;

-- fin_stock_writeoffs seed
INSERT INTO public.fin_stock_writeoffs (property_id, writeoff_number, writeoff_date, item_name, category, quantity, unit_cost, total_value, writeoff_type, reason, status, gl_posted) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WO-001', '2026-09-02', 'Bath Towels', 'Linens', 5, 45.00, 225.00, 'damage', 'Torn beyond repair during laundering', 'Pending', false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WO-002', '2026-08-28', 'Food Stock - Dry Goods', 'Food', 15, 13.75, 206.25, 'spoilage', 'Expired stock — past shelf life', 'Approved', false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WO-003', '2026-08-25', 'Wine Inventory - Premium', 'Beverages', 3, 92.50, 277.50, 'damage', 'Bottles broken during transport', 'Posted', true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WO-004', '2026-08-20', 'Body Lotion', 'Amenities', 20, 10.00, 200.00, 'expiry', 'Expired amenities — past use-by date', 'Approved', false),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WO-005', '2026-08-15', 'Floor Mop', 'Equipment', 2, 250.00, 500.00, 'obsolescence', 'Worn out — replaced with new model', 'Posted', true),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WO-006', '2026-08-10', 'Shampoo Bottles', 'Amenities', 10, 8.00, 80.00, 'damage', 'Leaking bottles — product loss', 'Rejected', false)
ON CONFLICT DO NOTHING;

-- fin_stock_revaluations seed
INSERT INTO public.fin_stock_revaluations (property_id, revaluation_number, revaluation_date, item_name, category, old_cost, new_cost, quantity, old_total_value, new_total_value, variance, reason, status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'REV-001', '2026-09-01', 'Wine Inventory - Premium', 'Beverages', 85.00, 92.50, 240, 20400.00, 22200.00, 1800.00, 'Market price adjustment — vintage appreciation', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'REV-002', '2026-08-20', 'King Size Sheets', 'Linens', 45.00, 42.00, 180, 8100.00, 7560.00, -540.00, 'Bulk purchase discount — new supplier contract', 'Approved'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'REV-003', '2026-08-15', 'Food Stock - Dry Goods', 'Food', 12.50, 13.75, 850, 10625.00, 11687.50, 1062.50, 'Supplier price increase — commodity inflation', 'Posted'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'REV-004', '2026-08-10', 'Cleaning Supplies Bulk', 'Cleaning Supplies', 8.00, 7.50, 320, 2560.00, 2400.00, -160.00, 'New vendor contract — negotiated lower rate', 'Approved'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'REV-005', '2026-08-05', 'Laundry Detergent', 'Cleaning Supplies', 165.00, 180.00, 50, 8250.00, 9000.00, 750.00, 'Supplier price increase — raw material costs', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'REV-006', '2026-07-25', 'Vacuum Cleaner', 'Equipment', 3200.00, 3500.00, 5, 16000.00, 17500.00, 1500.00, 'Model upgrade — higher specification unit', 'Posted')
ON CONFLICT DO NOTHING;
