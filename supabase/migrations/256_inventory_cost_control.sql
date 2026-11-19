-- Migration 256: Inventory & Cost Control Database Schema
-- Creates tables for inventory items, categories, and transactions

-- ════════════════════════════════════════════════════════════════════════
-- 0. Handle existing inventory_items table (rename to legacy if exists)
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_items') THEN
    EXECUTE 'ALTER TABLE public.inventory_items RENAME TO inventory_items_legacy';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Inventory Categories
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.inventory_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert predefined categories
INSERT INTO public.inventory_categories (name, code, description, sort_order) VALUES
  ('Raw Materials', 'RAW', 'Raw ingredients and produce', 1),
  ('Semi-Finished Goods', 'SEMI', 'Partially prepared items', 2),
  ('Finished Goods', 'FINISHED', 'Ready-to-serve items', 3),
  ('Packaging', 'PACK', 'Packaging materials', 4),
  ('Cleaning Supplies', 'CLEAN', 'Cleaning chemicals and supplies', 5),
  ('Disposable Items', 'DISPOSABLE', 'Single-use items', 6),
  ('Beverage Inventory', 'BEVERAGE', 'Wine, spirits, beer, etc.', 7)
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_inventory_categories_active ON public.inventory_categories(is_active);
ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Inventory Items
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category_id text NOT NULL REFERENCES public.inventory_categories(id) ON DELETE RESTRICT,
  outlet_id text REFERENCES public.outlets(id) ON DELETE SET NULL,
  item_code text UNIQUE,
  sku text UNIQUE,
  name text NOT NULL,
  description text,
  unit_of_measure text NOT NULL DEFAULT 'PCS', -- PCS, KG, L, ML, BOX, CASE, BOTTLE, etc.
  current_quantity numeric(10,3) NOT NULL DEFAULT 0,
  minimum_stock numeric(10,3) NOT NULL DEFAULT 0,
  maximum_stock numeric(10,3),
  reorder_point numeric(10,3) NOT NULL DEFAULT 0,
  unit_cost numeric(10,2) NOT NULL DEFAULT 0,
  average_cost numeric(10,2),
  total_value numeric(12,2) GENERATED ALWAYS AS (current_quantity * unit_cost) STORED,
  location text,
  supplier text,
  last_purchase_date date,
  expiry_date date,
  batch_number text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_outlet ON public.inventory_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_code ON public.inventory_items(item_code);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON public.inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_low_stock ON public.inventory_items(current_quantity, reorder_point) WHERE current_quantity <= reorder_point;
CREATE INDEX IF NOT EXISTS idx_inventory_items_expiry ON public.inventory_items(expiry_date) WHERE expiry_date IS NOT NULL;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Inventory Transactions
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item_id text NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL, -- goods_receipt, internal_transfer, production_consumption, production_output, stock_adjustment, stock_count, cycle_count, return, waste, expiry, spoilage
  quantity numeric(10,3) NOT NULL,
  unit_cost numeric(10,2),
  total_cost numeric(12,2),
  reference_number text, -- PO number, transfer ID, etc.
  from_outlet_id text REFERENCES public.outlets(id) ON DELETE SET NULL,
  to_outlet_id text REFERENCES public.outlets(id) ON DELETE SET NULL,
  reason text,
  performed_by text NOT NULL DEFAULT 'system',
  transaction_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item ON public.inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type ON public.inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_date ON public.inventory_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_outlet ON public.inventory_transactions(from_outlet_id);
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════
-- 4. RLS Policies
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['inventory_categories', 'inventory_items', 'inventory_transactions'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('CREATE POLICY "service_role all %s" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY "authenticated read %s" ON public.%I FOR SELECT USING (auth.role() = ''authenticated'')', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5. updated_at triggers
-- ══════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['inventory_categories', 'inventory_items'];
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