-- ============================================================
-- Unified Inventory & Stores Portal (Migration 346)
-- ============================================================
-- Implements the schema for the Unified Inventory & Stores
-- Portal per docs/unified_inventory_stores_portal.md.
--
-- Uses a dedicated `uinv_*` table namespace to avoid conflicts
-- with the legacy inventory_items / inventory_stores tables used
-- by ERPContext, and the F&B inventory_items table (migration 256).
-- This portal is the system of record for physical stock.
--
-- Tables:
--   uinv_items           — Item Master
--   uinv_stores          — Store Master (warehouses)
--   uinv_locations       — Location hierarchy (zone/rack/shelf/bin)
--   uinv_stock_balances  — On-hand stock per item/store/location
--   uinv_batches         — Batch/lot tracking with expiry
--   uinv_goods_receipts  — GRN header + lines (JSONB lines)
--   uinv_issues          — Department stock issues (header + JSONB lines)
--   uinv_transfers       — Inter-store / inter-property transfers
--   uinv_adjustments     — Stock adjustments
--   uinv_reservations    — Stock reservations
--   uinv_counts          — Stock counts (header + JSONB lines)
--   uinv_waste           — Waste & spoilage records
--   uinv_stock_ledger    — Immutable stock ledger
--   uinv_replenishment   — Replenishment requirements
--   uinv_config          — Portal configuration (JSONB sections)
-- ============================================================

-- Demo property used for multi-property scoping (matches HK/Eng portals).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'uinv_stock_status') THEN
    CREATE TYPE public.uinv_stock_status AS ENUM (
      'Available', 'Reserved', 'Allocated', 'Damaged',
      'Quarantined', 'Expired', 'Blocked', 'Under Inspection'
    );
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. uinv_items — Item Master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_code text NOT NULL,
  item_name text NOT NULL,
  description text,
  category text NOT NULL,
  subcategory text,
  item_type text NOT NULL DEFAULT 'Inventory Item',
  brand text,
  manufacturer text,
  sku text,
  barcode text,
  secondary_barcode text,
  unit_of_measure text NOT NULL DEFAULT 'PCS',
  base_unit text,
  purchase_unit text,
  stock_unit text,
  issue_unit text,
  inventory_controlled boolean NOT NULL DEFAULT true,
  batch_controlled boolean NOT NULL DEFAULT false,
  expiry_controlled boolean NOT NULL DEFAULT false,
  fefo_required boolean NOT NULL DEFAULT false,
  fifo_required boolean NOT NULL DEFAULT false,
  min_stock numeric(12,3) NOT NULL DEFAULT 0,
  max_stock numeric(12,3),
  reorder_point numeric(12,3) NOT NULL DEFAULT 0,
  safety_stock numeric(12,3) NOT NULL DEFAULT 0,
  par_level numeric(12,3) NOT NULL DEFAULT 0,
  default_store_id text,
  default_location text,
  costing_method text NOT NULL DEFAULT 'Weighted Average',
  last_cost numeric(12,2) NOT NULL DEFAULT 0,
  avg_cost numeric(12,2) NOT NULL DEFAULT 0,
  standard_cost numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_items_property ON public.uinv_items(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_items_category ON public.uinv_items(category);
CREATE INDEX IF NOT EXISTS idx_uinv_items_active ON public.uinv_items(is_active);
ALTER TABLE public.uinv_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_items" ON public.uinv_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_items" ON public.uinv_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_items TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_stores — Store Master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_stores (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  store_code text NOT NULL,
  store_name text NOT NULL,
  store_type text NOT NULL DEFAULT 'Warehouse',
  parent_store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  manager text,
  location text,
  capacity numeric(12,3),
  temperature_zone text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, store_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_stores_property ON public.uinv_stores(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_stores_active ON public.uinv_stores(is_active);
ALTER TABLE public.uinv_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_stores" ON public.uinv_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_stores" ON public.uinv_stores FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_stores TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_locations — Location hierarchy (zone/rack/shelf/bin)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_locations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  store_id text NOT NULL REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  location_code text NOT NULL,
  location_name text NOT NULL,
  location_type text NOT NULL DEFAULT 'Bin',
  parent_location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  temperature_zone text,
  capacity numeric(12,3),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, location_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_locations_store ON public.uinv_locations(store_id);
ALTER TABLE public.uinv_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_locations" ON public.uinv_locations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_locations" ON public.uinv_locations FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_locations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. uinv_stock_balances — On-hand stock per item/store/location
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_stock_balances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text NOT NULL REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  on_hand numeric(12,3) NOT NULL DEFAULT 0,
  reserved numeric(12,3) NOT NULL DEFAULT 0,
  allocated numeric(12,3) NOT NULL DEFAULT 0,
  on_order numeric(12,3) NOT NULL DEFAULT 0,
  in_transit numeric(12,3) NOT NULL DEFAULT 0,
  damaged numeric(12,3) NOT NULL DEFAULT 0,
  quarantined numeric(12,3) NOT NULL DEFAULT 0,
  expired numeric(12,3) NOT NULL DEFAULT 0,
  status public.uinv_stock_status NOT NULL DEFAULT 'Available',
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  last_movement_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, store_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_uinv_stock_item ON public.uinv_stock_balances(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_stock_store ON public.uinv_stock_balances(store_id);
CREATE INDEX IF NOT EXISTS idx_uinv_stock_property ON public.uinv_stock_balances(property_id);
ALTER TABLE public.uinv_stock_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_stock_balances" ON public.uinv_stock_balances FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_stock_balances" ON public.uinv_stock_balances FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_stock_balances TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. uinv_batches — Batch/lot tracking with expiry
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_batches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  batch_number text NOT NULL,
  lot_number text,
  manufacturing_date date,
  expiry_date date,
  received_date date,
  supplier text,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  status public.uinv_stock_status NOT NULL DEFAULT 'Available',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_batches_item ON public.uinv_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_batches_expiry ON public.uinv_batches(expiry_date) WHERE expiry_date IS NOT NULL;
ALTER TABLE public.uinv_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_batches" ON public.uinv_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_batches" ON public.uinv_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_batches TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. uinv_goods_receipts — GRN header (lines in JSONB)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_goods_receipts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  grn_number text NOT NULL,
  purchase_order text,
  supplier text,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  receiving_date date NOT NULL DEFAULT CURRENT_DATE,
  receiver text,
  delivery_note text,
  invoice_reference text,
  vehicle_reference text,
  inspection_status text NOT NULL DEFAULT 'Pending',
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_value numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Received',
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_grn_property ON public.uinv_goods_receipts(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_grn_status ON public.uinv_goods_receipts(status);
CREATE INDEX IF NOT EXISTS idx_uinv_grn_date ON public.uinv_goods_receipts(receiving_date);
ALTER TABLE public.uinv_goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_goods_receipts" ON public.uinv_goods_receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_goods_receipts" ON public.uinv_goods_receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_goods_receipts TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. uinv_issues — Department stock issues (lines in JSONB)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  issue_number text NOT NULL,
  department text NOT NULL,
  requester text,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  required_date date,
  priority text NOT NULL DEFAULT 'Normal',
  cost_center text,
  purpose text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL DEFAULT 'Pending',
  approved_by text,
  approved_at timestamptz,
  issued_by text,
  issued_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_issues_property ON public.uinv_issues(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_issues_status ON public.uinv_issues(approval_status);
CREATE INDEX IF NOT EXISTS idx_uinv_issues_dept ON public.uinv_issues(department);
ALTER TABLE public.uinv_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_issues" ON public.uinv_issues FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_issues" ON public.uinv_issues FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_issues TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 8. uinv_transfers — Inter-store / inter-property transfers
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_transfers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  transfer_number text NOT NULL,
  from_store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  to_store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  from_property_id uuid,
  to_property_id uuid,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  transfer_value numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending',
  priority text NOT NULL DEFAULT 'Normal',
  approved_by text,
  approved_at timestamptz,
  dispatched_by text,
  dispatched_at timestamptz,
  received_by text,
  received_at timestamptz,
  reason text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_transfers_property ON public.uinv_transfers(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_transfers_status ON public.uinv_transfers(status);
ALTER TABLE public.uinv_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_transfers" ON public.uinv_transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_transfers" ON public.uinv_transfers FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_transfers TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 9. uinv_adjustments — Stock adjustments
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_adjustments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  adjustment_number text NOT NULL,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  adjustment_type text NOT NULL,
  reason text NOT NULL,
  quantity_delta numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  value_delta numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending',
  approved_by text,
  approved_at timestamptz,
  reference text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_adj_property ON public.uinv_adjustments(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_adj_item ON public.uinv_adjustments(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_adj_status ON public.uinv_adjustments(status);
ALTER TABLE public.uinv_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_adjustments" ON public.uinv_adjustments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_adjustments" ON public.uinv_adjustments FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_adjustments TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 10. uinv_reservations — Stock reservations
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_reservations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  reservation_number text NOT NULL,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  department text,
  reference text,
  required_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'Active',
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_reservations_item ON public.uinv_reservations(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_reservations_status ON public.uinv_reservations(status);
ALTER TABLE public.uinv_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_reservations" ON public.uinv_reservations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_reservations" ON public.uinv_reservations FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_reservations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 11. uinv_counts — Stock counts (header + JSONB lines)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_counts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  count_number text NOT NULL,
  count_type text NOT NULL DEFAULT 'Cycle Count',
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  is_blind boolean NOT NULL DEFAULT false,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_variance numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Draft',
  started_at timestamptz,
  completed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_counts_property ON public.uinv_counts(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_counts_status ON public.uinv_counts(status);
ALTER TABLE public.uinv_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_counts" ON public.uinv_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_counts" ON public.uinv_counts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_counts TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 12. uinv_waste — Waste & spoilage records
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_waste (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  waste_number text NOT NULL,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  waste_type text NOT NULL DEFAULT 'Spoilage',
  reason text,
  department text,
  status text NOT NULL DEFAULT 'Pending',
  approved_by text,
  approved_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_waste_property ON public.uinv_waste(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_waste_item ON public.uinv_waste(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_waste_status ON public.uinv_waste(status);
ALTER TABLE public.uinv_waste ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_waste" ON public.uinv_waste FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_waste" ON public.uinv_waste FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_waste TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 13. uinv_stock_ledger — Immutable stock ledger
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_stock_ledger (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  transaction_type text NOT NULL,
  reference text,
  quantity_in numeric(12,3) NOT NULL DEFAULT 0,
  quantity_out numeric(12,3) NOT NULL DEFAULT 0,
  balance numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  value numeric(14,2) NOT NULL DEFAULT 0,
  performed_by text,
  reason text,
  transaction_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_ledger_item ON public.uinv_stock_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ledger_store ON public.uinv_stock_ledger(store_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ledger_date ON public.uinv_stock_ledger(transaction_date);
CREATE INDEX IF NOT EXISTS idx_uinv_ledger_type ON public.uinv_stock_ledger(transaction_type);
ALTER TABLE public.uinv_stock_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read uinv_stock_ledger" ON public.uinv_stock_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert uinv_stock_ledger" ON public.uinv_stock_ledger FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "service_role all uinv_stock_ledger" ON public.uinv_stock_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.uinv_stock_ledger TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 14. uinv_replenishment — Replenishment requirements
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_replenishment (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  current_stock numeric(12,3) NOT NULL DEFAULT 0,
  reorder_point numeric(12,3) NOT NULL DEFAULT 0,
  par_level numeric(12,3) NOT NULL DEFAULT 0,
  suggested_qty numeric(12,3) NOT NULL DEFAULT 0,
  urgency text NOT NULL DEFAULT 'Normal',
  status text NOT NULL DEFAULT 'Open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_repl_property ON public.uinv_replenishment(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_repl_status ON public.uinv_replenishment(status);
ALTER TABLE public.uinv_replenishment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_replenishment" ON public.uinv_replenishment FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_replenishment" ON public.uinv_replenishment FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_replenishment TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 15. uinv_config — Portal configuration (JSONB sections)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  section text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, section)
);
ALTER TABLE public.uinv_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_config" ON public.uinv_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_config" ON public.uinv_config FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_config TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 16. Seed data — demo property
-- ════════════════════════════════════════════════════════════════
-- Demo property id (matches HK/Eng portals)
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Stores
  INSERT INTO public.uinv_stores (id, property_id, store_code, store_name, store_type, manager, location, capacity, temperature_zone, is_active) VALUES
    ('UINV-ST-MAIN', prop_id, 'MAIN', 'Main Warehouse', 'Warehouse', 'John Storekeeper', 'Central', 50000, 'Ambient', true),
    ('UINV-ST-FOOD', prop_id, 'FOOD', 'Food Store', 'Warehouse', 'Chef Marco', 'Kitchen Block', 15000, 'Mixed', true),
    ('UINV-ST-BEV', prop_id, 'BEV', 'Beverage Store', 'Warehouse', 'Bartender Lead', 'Bar Block', 8000, 'Ambient', true),
    ('UINV-ST-HK', prop_id, 'HK', 'Housekeeping Store', 'Warehouse', 'Alice Johnson', 'Housekeeping Block', 12000, 'Ambient', true),
    ('UINV-ST-ENG', prop_id, 'ENG', 'Engineering Store', 'Warehouse', 'Tom Bradley', 'Engineering Block', 10000, 'Ambient', true),
    ('UINV-ST-LINEN', prop_id, 'LINEN', 'Linen Store', 'Warehouse', 'Alice Johnson', 'Laundry Block', 6000, 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;

  -- Locations
  INSERT INTO public.uinv_locations (id, store_id, location_code, location_name, location_type, temperature_zone, is_active) VALUES
    ('UINV-LOC-MAIN-A1', 'UINV-ST-MAIN', 'A1', 'Rack A Shelf 1', 'Shelf', 'Ambient', true),
    ('UINV-LOC-MAIN-A2', 'UINV-ST-MAIN', 'A2', 'Rack A Shelf 2', 'Shelf', 'Ambient', true),
    ('UINV-LOC-FOOD-COLD', 'UINV-ST-FOOD', 'COLD-1', 'Cold Storage 1', 'Zone', 'Cold', true),
    ('UINV-LOC-FOOD-DRY', 'UINV-ST-FOOD', 'DRY-1', 'Dry Storage 1', 'Zone', 'Ambient', true),
    ('UINV-LOC-HK-1', 'UINV-ST-HK', 'HK-1', 'HK Shelf 1', 'Shelf', 'Ambient', true),
    ('UINV-LOC-ENG-1', 'UINV-ST-ENG', 'ENG-1', 'ENG Shelf 1', 'Shelf', 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;

  -- Items
  INSERT INTO public.uinv_items (id, property_id, item_code, item_name, description, category, subcategory, item_type, brand, unit_of_measure, batch_controlled, expiry_controlled, fefo_required, min_stock, max_stock, reorder_point, safety_stock, par_level, default_store_id, costing_method, last_cost, avg_cost, standard_cost, is_active) VALUES
    ('UINV-IT-001', prop_id, 'FVG-001', 'Fresh Organic Tomatoes', 'Fresh vine tomatoes', 'Food & Beverage', 'Fresh Produce', 'Food', 'GreenFields', 'kg', false, true, true, 30, 500, 50, 20, 100, 'UINV-ST-FOOD', 'Weighted Average', 12.50, 12.50, 12.00, true),
    ('UINV-IT-002', prop_id, 'FVG-002', 'Chicken Breast Fillet', 'Boneless chicken breast', 'Food & Beverage', 'Meat & Poultry', 'Food', 'Prime Farms', 'kg', false, true, true, 20, 300, 40, 15, 80, 'UINV-ST-FOOD', 'Weighted Average', 45.00, 45.00, 44.00, true),
    ('UINV-IT-003', prop_id, 'FVB-003', 'Mineral Water 500ml', 'Natural mineral water', 'Food & Beverage', 'Beverages', 'Beverage', 'AquaPure', 'pcs', false, false, false, 100, 2000, 200, 50, 500, 'UINV-ST-BEV', 'Weighted Average', 3.50, 3.50, 3.40, true),
    ('UINV-IT-004', prop_id, 'HKG-001', 'Luxury Shampoo 30ml', 'Guest amenity shampoo', 'Housekeeping', 'Guest Amenities', 'Consumable', 'LuxeScent', 'pcs', false, false, false, 200, 5000, 500, 100, 1000, 'UINV-ST-HK', 'Weighted Average', 1.20, 1.20, 1.15, true),
    ('UINV-IT-005', prop_id, 'HKC-002', 'All-Purpose Cleaner', 'Multi-surface cleaner', 'Housekeeping', 'Cleaning Chemicals', 'Consumable', 'CleanMax', 'ltr', false, true, false, 10, 200, 30, 5, 50, 'UINV-ST-HK', 'Weighted Average', 18.00, 18.00, 17.50, true),
    ('UINV-IT-006', prop_id, 'ENG-001', 'LED Bulb 9W', 'Energy-efficient LED bulb', 'Engineering', 'Electrical', 'Spare Part', 'BrightLight', 'pcs', false, false, false, 20, 300, 50, 10, 100, 'UINV-ST-ENG', 'Weighted Average', 8.50, 8.50, 8.00, true),
    ('UINV-IT-007', prop_id, 'ENP-002', 'PVC Pipe 20mm', 'Plumbing PVC pipe', 'Engineering', 'Plumbing', 'Spare Part', 'FlowTech', 'mtr', false, false, false, 25, 500, 60, 15, 150, 'UINV-ST-ENG', 'Weighted Average', 6.00, 6.00, 5.80, true),
    ('UINV-IT-008', prop_id, 'FVB-004', 'Ethiopian Coffee Beans 1kg', 'Single-origin roasted beans', 'Food & Beverage', 'Beverages', 'Beverage', 'Habesha Roast', 'kg', false, false, false, 10, 100, 15, 5, 30, 'UINV-ST-FOOD', 'Weighted Average', 35.00, 35.00, 34.00, true),
    ('UINV-IT-009', prop_id, 'HKL-003', 'Linen Bed Sheets King', 'King-size bed linen', 'Housekeeping', 'Laundry Supplies', 'Consumable', 'SoftThread', 'pcs', false, false, false, 15, 150, 25, 10, 50, 'UINV-ST-LINEN', 'Weighted Average', 65.00, 65.00, 64.00, true),
    ('UINV-IT-010', prop_id, 'ENG-003', 'Air Filter 16x25x1', 'HVAC air filter', 'Engineering', 'HVAC', 'Spare Part', 'FilterPro', 'pcs', false, false, false, 8, 80, 15, 5, 30, 'UINV-ST-ENG', 'Weighted Average', 22.00, 22.00, 21.00, true)
  ON CONFLICT (id) DO NOTHING;

  -- Stock balances
  INSERT INTO public.uinv_stock_balances (id, property_id, item_id, store_id, location_id, on_hand, reserved, allocated, on_order, in_transit, damaged, quarantined, expired, status, unit_cost) VALUES
    ('UINV-SB-001', prop_id, 'UINV-IT-001', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 120, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 12.50),
    ('UINV-SB-002', prop_id, 'UINV-IT-002', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 85, 10, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 45.00),
    ('UINV-SB-003', prop_id, 'UINV-IT-003', 'UINV-ST-BEV', NULL, 450, 50, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 3.50),
    ('UINV-SB-004', prop_id, 'UINV-IT-004', 'UINV-ST-HK', 'UINV-LOC-HK-1', 1200, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 1.20),
    ('UINV-SB-005', prop_id, 'UINV-IT-005', 'UINV-ST-HK', 'UINV-LOC-HK-1', 45, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 18.00),
    ('UINV-SB-006', prop_id, 'UINV-IT-006', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', 95, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 8.50),
    ('UINV-SB-007', prop_id, 'UINV-IT-007', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', 130, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 6.00),
    ('UINV-SB-008', prop_id, 'UINV-IT-008', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-DRY', 28, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 35.00),
    ('UINV-SB-009', prop_id, 'UINV-IT-009', 'UINV-ST-LINEN', NULL, 40, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 65.00),
    ('UINV-SB-010', prop_id, 'UINV-IT-010', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', 18, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 22.00)
  ON CONFLICT (id) DO NOTHING;

  -- Batches (with expiry for FEFO items)
  INSERT INTO public.uinv_batches (id, item_id, store_id, batch_number, lot_number, manufacturing_date, expiry_date, received_date, supplier, quantity, unit_cost, status) VALUES
    ('UINV-BT-001', 'UINV-IT-001', 'UINV-ST-FOOD', 'B-105', 'L-105', '2026-07-01', '2027-04-15', '2026-08-01', 'Global Foods Ltd', 120, 12.50, 'Available'::public.uinv_stock_status),
    ('UINV-BT-002', 'UINV-IT-002', 'UINV-ST-FOOD', 'B-401', 'L-401', '2026-08-20', '2026-08-30', '2026-08-21', 'Prime Meats & Poultry', 85, 45.00, 'Available'::public.uinv_stock_status),
    ('UINV-BT-003', 'UINV-IT-005', 'UINV-ST-HK', 'B-203', NULL, '2026-06-01', '2028-01-01', '2026-06-15', 'Luxe Hospitality Supplies', 45, 18.00, 'Available'::public.uinv_stock_status)
  ON CONFLICT (id) DO NOTHING;

  -- Goods receipts
  INSERT INTO public.uinv_goods_receipts (id, property_id, grn_number, purchase_order, supplier, store_id, receiving_date, receiver, delivery_note, invoice_reference, inspection_status, lines, total_value, status) VALUES
    ('UINV-GRN-001', prop_id, 'GRN-2026-0001', 'PO-5023', 'Global Foods Ltd', 'UINV-ST-FOOD', '2026-08-01', 'John Storekeeper', 'DN-12345', 'INV-4001', 'Accepted',
      '[{"itemId":"UINV-IT-001","itemName":"Fresh Organic Tomatoes","orderedQty":120,"deliveredQty":120,"acceptedQty":120,"rejectedQty":0,"unit":"kg","batchNumber":"B-105","expiryDate":"2027-04-15","unitCost":12.50,"storageLocation":"Cold Storage 1"}]'::jsonb,
      1500.00, 'Received'),
    ('UINV-GRN-002', prop_id, 'GRN-2026-0002', 'PO-5024', 'Technical Maintenance Parts', 'UINV-ST-ENG', '2026-08-03', 'John Storekeeper', 'DN-12346', 'INV-4002', 'Accepted',
      '[{"itemId":"UINV-IT-006","itemName":"LED Bulb 9W","orderedQty":50,"deliveredQty":50,"acceptedQty":50,"rejectedQty":0,"unit":"pcs","batchNumber":"B-301","unitCost":8.50,"storageLocation":"ENG Shelf 1"}]'::jsonb,
      425.00, 'Received'),
    ('UINV-GRN-003', prop_id, 'GRN-2026-0003', 'PO-5025', 'Prime Meats & Poultry', 'UINV-ST-FOOD', '2026-08-21', 'John Storekeeper', 'DN-12347', 'INV-4003', 'Under Inspection',
      '[{"itemId":"UINV-IT-002","itemName":"Chicken Breast Fillet","orderedQty":40,"deliveredQty":40,"acceptedQty":40,"rejectedQty":0,"unit":"kg","batchNumber":"B-401","expiryDate":"2026-08-30","unitCost":45.00,"storageLocation":"Cold Storage 1"}]'::jsonb,
      1800.00, 'Received')
  ON CONFLICT (id) DO NOTHING;

  -- Issues
  INSERT INTO public.uinv_issues (id, property_id, issue_number, department, requester, store_id, required_date, priority, cost_center, purpose, lines, approval_status, issued_by, issued_at) VALUES
    ('UINV-IS-001', prop_id, 'ISS-2026-0001', 'Housekeeping', 'Alice Johnson', 'UINV-ST-HK', '2026-08-15', 'Normal', 'HK-CC-01', 'Floor stock replenishment',
      '[{"itemId":"UINV-IT-004","itemName":"Luxury Shampoo 30ml","requestedQty":200,"approvedQty":200,"issuedQty":200,"unit":"pcs","batchNumber":null,"location":"HK Shelf 1"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-15 09:00:00+00'),
    ('UINV-IS-002', prop_id, 'ISS-2026-0002', 'Restaurant', 'Chef Marco', 'UINV-ST-FOOD', '2026-08-25', 'High', 'FB-CC-01', 'Dinner service prep',
      '[{"itemId":"UINV-IT-001","itemName":"Fresh Organic Tomatoes","requestedQty":50,"approvedQty":0,"issuedQty":0,"unit":"kg","batchNumber":null,"location":"Cold Storage 1"}]'::jsonb,
      'Pending', NULL, NULL),
    ('UINV-IS-003', prop_id, 'ISS-2026-0003', 'Engineering', 'Tom Bradley', 'UINV-ST-ENG', '2026-08-28', 'Urgent', 'ENG-CC-01', 'Room maintenance',
      '[{"itemId":"UINV-IT-006","itemName":"LED Bulb 9W","requestedQty":20,"approvedQty":20,"issuedQty":20,"unit":"pcs","batchNumber":null,"location":"ENG Shelf 1"}]'::jsonb,
      'Approved', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Transfers
  INSERT INTO public.uinv_transfers (id, property_id, transfer_number, from_store_id, to_store_id, lines, transfer_value, status, priority, dispatched_by, dispatched_at, reason) VALUES
    ('UINV-TX-001', prop_id, 'TX-2026-0001', 'UINV-ST-MAIN', 'UINV-ST-BEV',
      '[{"itemId":"UINV-IT-003","itemName":"Mineral Water 500ml","quantity":100,"unit":"pcs","unitCost":3.50}]'::jsonb,
      350.00, 'In Transit', 'Normal', 'John Storekeeper', '2026-08-27 10:00:00+00', 'Bar stock replenishment'),
    ('UINV-TX-002', prop_id, 'TX-2026-0002', 'UINV-ST-FOOD', 'UINV-ST-HK',
      '[{"itemId":"UINV-IT-005","itemName":"All-Purpose Cleaner","quantity":5,"unit":"ltr","unitCost":18.00}]'::jsonb,
      90.00, 'Pending', 'Normal', NULL, NULL, 'HK cleaning supply')
  ON CONFLICT (id) DO NOTHING;

  -- Adjustments
  INSERT INTO public.uinv_adjustments (id, property_id, adjustment_number, item_id, store_id, adjustment_type, reason, quantity_delta, unit_cost, value_delta, status, reference, notes) VALUES
    ('UINV-AD-001', prop_id, 'ADJ-2026-0001', 'UINV-IT-008', 'UINV-ST-FOOD', 'Count Variance', 'Cycle count variance', -2, 35.00, -70.00, 'Approved', 'CNT-001', 'Found 2kg short during cycle count'),
    ('UINV-AD-002', prop_id, 'ADJ-2026-0002', 'UINV-IT-004', 'UINV-ST-HK', 'Damage', 'Damaged in transit', -5, 1.20, -6.00, 'Pending', NULL, 'Crushed during delivery')
  ON CONFLICT (id) DO NOTHING;

  -- Reservations
  INSERT INTO public.uinv_reservations (id, property_id, reservation_number, item_id, store_id, quantity, department, reference, required_date, expiry_date, status) VALUES
    ('UINV-RS-001', prop_id, 'RES-2026-0001', 'UINV-IT-002', 'UINV-ST-FOOD', 10, 'Restaurant', 'BANQUET-EVT-001', '2026-08-30', '2026-09-05', 'Active'),
    ('UINV-RS-002', prop_id, 'RES-2026-0002', 'UINV-IT-003', 'UINV-ST-BEV', 50, 'Banquet', 'BANQUET-EVT-002', '2026-09-01', '2026-09-07', 'Active')
  ON CONFLICT (id) DO NOTHING;

  -- Counts
  INSERT INTO public.uinv_counts (id, property_id, count_number, count_type, store_id, is_blind, lines, total_variance, status, started_at) VALUES
    ('UINV-CN-001', prop_id, 'CNT-2026-0001', 'Cycle Count', 'UINV-ST-FOOD', false,
      '[{"itemId":"UINV-IT-008","itemName":"Ethiopian Coffee Beans 1kg","systemQty":30,"physicalQty":28,"variance":-2,"unitCost":35.00,"varianceValue":-70.00}]'::jsonb,
      -70.00, 'Completed', '2026-08-20 08:00:00+00'),
    ('UINV-CN-002', prop_id, 'CNT-2026-0002', 'Physical Count', 'UINV-ST-HK', true,
      '[]'::jsonb, 0.00, 'In Progress', '2026-08-28 08:00:00+00')
  ON CONFLICT (id) DO NOTHING;

  -- Waste
  INSERT INTO public.uinv_waste (id, property_id, waste_number, item_id, store_id, quantity, unit_cost, total_cost, waste_type, reason, department, status) VALUES
    ('UINV-WA-001', prop_id, 'WST-2026-0001', 'UINV-IT-001', 'UINV-ST-FOOD', 3, 12.50, 37.50, 'Spoilage', 'Over-ripe produce', 'Kitchen', 'Approved'),
    ('UINV-WA-002', prop_id, 'WST-2026-0002', 'UINV-IT-004', 'UINV-ST-HK', 5, 1.20, 6.00, 'Damage', 'Crushed packaging', 'Housekeeping', 'Pending')
  ON CONFLICT (id) DO NOTHING;

  -- Stock ledger (opening balances + a few movements)
  INSERT INTO public.uinv_stock_ledger (id, property_id, item_id, store_id, location_id, batch_id, transaction_type, reference, quantity_in, quantity_out, balance, unit_cost, value, performed_by, reason, transaction_date) VALUES
    ('UINV-LG-001', prop_id, 'UINV-IT-001', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 'UINV-BT-001', 'Opening Balance', 'OB-001', 120, 0, 120, 12.50, 1500.00, 'System', 'Opening balance', '2026-08-01 00:00:00+00'),
    ('UINV-LG-002', prop_id, 'UINV-IT-002', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 'UINV-BT-002', 'Goods Receipt', 'GRN-2026-0003', 85, 0, 85, 45.00, 3825.00, 'John Storekeeper', 'Receipt from Prime Meats', '2026-08-21 09:00:00+00'),
    ('UINV-LG-003', prop_id, 'UINV-IT-004', 'UINV-ST-HK', 'UINV-LOC-HK-1', NULL, 'Department Issue', 'ISS-2026-0001', 0, 200, 1000, 1.20, 240.00, 'John Storekeeper', 'Issue to Housekeeping', '2026-08-15 09:00:00+00'),
    ('UINV-LG-004', prop_id, 'UINV-IT-008', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-DRY', NULL, 'Count Adjustment', 'CNT-2026-0001', 0, 2, 28, 35.00, 70.00, 'System', 'Cycle count variance', '2026-08-20 10:00:00+00'),
    ('UINV-LG-005', prop_id, 'UINV-IT-001', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 'UINV-BT-001', 'Waste', 'WST-2026-0001', 0, 3, 117, 12.50, 37.50, 'Chef Marco', 'Spoilage', '2026-08-22 14:00:00+00')
  ON CONFLICT (id) DO NOTHING;

  -- Replenishment requirements
  INSERT INTO public.uinv_replenishment (id, property_id, item_id, store_id, current_stock, reorder_point, par_level, suggested_qty, urgency, status) VALUES
    ('UINV-RP-001', prop_id, 'UINV-IT-005', 'UINV-ST-HK', 45, 30, 50, 55, 'High', 'Open'),
    ('UINV-RP-002', prop_id, 'UINV-IT-010', 'UINV-ST-ENG', 18, 15, 30, 27, 'Urgent', 'Open'),
    ('UINV-RP-003', prop_id, 'UINV-IT-008', 'UINV-ST-FOOD', 28, 15, 30, 12, 'Normal', 'Open')
  ON CONFLICT (id) DO NOTHING;

  -- Config
  INSERT INTO public.uinv_config (id, property_id, section, config) VALUES
    ('UINV-CFG-001', prop_id, 'expiry_alerts', '{"thresholdsDays":[90,60,30,14,7],"expiredAlert":true}'::jsonb),
    ('UINV-CFG-002', prop_id, 'waste_approval', '{"valueThreshold":100,"quantityThreshold":10,"requireManagerApproval":true}'::jsonb),
    ('UINV-CFG-003', prop_id, 'valuation', '{"method":"Weighted Average","includeLandedCost":false}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 17. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_items','uinv_stores','uinv_locations','uinv_stock_balances','uinv_batches','uinv_goods_receipts','uinv_issues','uinv_transfers','uinv_adjustments','uinv_reservations','uinv_counts','uinv_waste','uinv_replenishment','uinv_config'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format(
        'CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
        t, t
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
