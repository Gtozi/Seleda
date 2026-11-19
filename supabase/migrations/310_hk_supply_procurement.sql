-- Migration: Housekeeping Supply & Procurement
--
-- Mirrors the F&B "Supplier & Procurement Coordination" feature
-- (fb_purchase_orders / fb_purchase_order_lines) but for the Housekeeping
-- department. HK creates purchase requisitions (stored as hk_purchase_orders)
-- that are dispatched to the Procurement department, and tracks them through
-- draft → submitted → acknowledged → partial → received → closed.
--
-- Supplier master data is shared with F&B via fb_suppliers (cleaning supplies,
-- linens, amenities, equipment vendors are common across departments). PO lines
-- reference inventory_items (the shared HK inventory ledger) so received goods
-- can be reconciled against HK stock.

-- ── 1. Housekeeping Purchase Orders ───────────────────────────────────
CREATE TABLE IF NOT EXISTS hk_purchase_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT REFERENCES fb_suppliers(id) ON DELETE SET NULL,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','acknowledged','partial','received','closed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expected_delivery_date TIMESTAMP WITH TIME ZONE,
  actual_delivery_date TIMESTAMP WITH TIME ZONE,
  subtotal NUMERIC(12, 2) DEFAULT 0,
  tax_amount NUMERIC(12, 2) DEFAULT 0,
  total_amount NUMERIC(12, 2) DEFAULT 0,
  currency TEXT DEFAULT 'ETB',
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','partial','paid','overdue')),
  notes TEXT,
  submitted_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 2. Housekeeping Purchase Order Lines ──────────────────────────────
CREATE TABLE IF NOT EXISTS hk_purchase_order_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  po_id TEXT NOT NULL REFERENCES hk_purchase_orders(id) ON DELETE CASCADE,
  item_id TEXT, -- references inventory_items (HK stock); nullable for ad-hoc items
  description TEXT,
  quantity_ordered NUMERIC(10, 3) NOT NULL,
  quantity_received NUMERIC(10, 3) DEFAULT 0,
  unit_of_measure TEXT NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  expected_date TIMESTAMP WITH TIME ZONE,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_purchase_orders_supplier ON hk_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_hk_purchase_orders_status ON hk_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_hk_purchase_orders_property ON hk_purchase_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_purchase_orders_date ON hk_purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_hk_purchase_order_lines_po ON hk_purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_hk_purchase_order_lines_item ON hk_purchase_order_lines(item_id);

-- ── 3. updated_at trigger ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_hk_po_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_purchase_orders_updated_at ON hk_purchase_orders;
CREATE TRIGGER trigger_hk_purchase_orders_updated_at
  BEFORE UPDATE ON hk_purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_po_timestamp();

-- ── 4. Permissions ────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON hk_purchase_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hk_purchase_order_lines TO authenticated;

-- Register the hk:po:create permission (mirrors fb:po:create used by F&B).
INSERT INTO permissions (id, code, module, description)
VALUES
  ('perm-hk-po-create', 'hk:po:create', 'housekeeping',
   'Create housekeeping purchase requisitions / purchase orders to suppliers')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, code, module, description)
SELECT 'perm-hk-po-create', 'hk:po:create', 'housekeeping',
       'Create housekeeping purchase requisitions / purchase orders to suppliers'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hk:po:create');

-- Grant to hk_supervisor and hk_manager roles (same pattern as 309).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('hk_supervisor', 'hk_manager')
  AND p.code = 'hk:po:create'
ON CONFLICT DO NOTHING;
