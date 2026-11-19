-- ============================================================
-- Engineering Portal — Supply & Procurement (Migration 331)
-- ============================================================
-- Replaces the mock Vendor & Contractors tab with a DB-backed
-- Supply & Procurement module mirroring the HK pattern.
--
-- Creates:
--   1. eng_purchase_orders — purchase requisitions sent to Procurement
--      (status flow: draft → submitted → acknowledged → partial →
--       received → closed | cancelled).
--   2. eng_purchase_order_lines — line items on each PO.
--
-- Reuses the shared fb_suppliers table as the supplier master.
-- RLS enabled; 'authenticated' role granted CRUD.
-- ============================================================

-- ── 1. eng_purchase_orders ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_purchase_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  po_number text NOT NULL UNIQUE,
  supplier_id text REFERENCES public.fb_suppliers(id) ON DELETE SET NULL,
  property_id text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','acknowledged','partial','received','closed','cancelled')),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  order_date timestamptz DEFAULT now(),
  expected_delivery_date timestamptz,
  actual_delivery_date timestamptz,
  subtotal numeric DEFAULT 0,
  tax_amount numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  currency text DEFAULT 'ETB',
  payment_status text DEFAULT 'pending',
  notes text,
  submitted_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── 2. eng_purchase_order_lines ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_purchase_order_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  po_id text NOT NULL REFERENCES public.eng_purchase_orders(id) ON DELETE CASCADE,
  item_id text,
  description text,
  quantity_ordered numeric NOT NULL DEFAULT 0,
  quantity_received numeric DEFAULT 0,
  unit_of_measure text NOT NULL DEFAULT 'pcs',
  unit_price numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  expected_date timestamptz,
  reason text,
  created_at timestamptz DEFAULT now()
);

-- ── 3. Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_eng_po_property ON public.eng_purchase_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_po_status ON public.eng_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_eng_po_supplier ON public.eng_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_eng_pol_po_id ON public.eng_purchase_order_lines(po_id);

-- ── 4. RLS ──────────────────────────────────────────────────────
ALTER TABLE public.eng_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eng_purchase_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eng_po_select_authenticated" ON public.eng_purchase_orders;
CREATE POLICY eng_po_select_authenticated ON public.eng_purchase_orders
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "eng_po_insert_authenticated" ON public.eng_purchase_orders;
CREATE POLICY eng_po_insert_authenticated ON public.eng_purchase_orders
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "eng_po_update_authenticated" ON public.eng_purchase_orders;
CREATE POLICY eng_po_update_authenticated ON public.eng_purchase_orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "eng_po_delete_authenticated" ON public.eng_purchase_orders;
CREATE POLICY eng_po_delete_authenticated ON public.eng_purchase_orders
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "eng_pol_select_authenticated" ON public.eng_purchase_order_lines;
CREATE POLICY eng_pol_select_authenticated ON public.eng_purchase_order_lines
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "eng_pol_insert_authenticated" ON public.eng_purchase_order_lines;
CREATE POLICY eng_pol_insert_authenticated ON public.eng_purchase_order_lines
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "eng_pol_update_authenticated" ON public.eng_purchase_order_lines;
CREATE POLICY eng_pol_update_authenticated ON public.eng_purchase_order_lines
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "eng_pol_delete_authenticated" ON public.eng_purchase_order_lines;
CREATE POLICY eng_pol_delete_authenticated ON public.eng_purchase_order_lines
  FOR DELETE TO authenticated USING (true);

-- ── 5. updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.eng_po_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS eng_po_updated_at ON public.eng_purchase_orders;
CREATE TRIGGER eng_po_updated_at BEFORE UPDATE ON public.eng_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.eng_po_set_updated_at();
