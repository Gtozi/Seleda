-- ============================================================
-- Unified Inventory & Stores Portal — Physical Resources (Migration 366)
-- ============================================================
-- Implements the physical-resource modules per
-- docs/unified_inventory_stores_portal_expanded.md §43–§52.
--
-- Tables:
--   uinv_tools              — Equipment & tools master
--   uinv_tool_assignments   — Tool issue/return to staff
--   uinv_tool_calibrations  — Tool calibration records
--   uinv_linen_items        — Linen stock master (controlled inventory)
--   uinv_linen_movements    — Linen movements (issue/laundry/return/damage)
--   uinv_uniform_items      — Uniform stock master
--   uinv_uniform_assignments— Uniform issue to employees
--   uinv_returnable_items   — Returnable/consignment items master
--   uinv_returnable_movements — Returnable item movements
--   uinv_loanable_items     — Loanable equipment master
--   uinv_loan_transactions  — Loan issue/return transactions
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. uinv_tools — Equipment & tools master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_tools (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  tool_code text NOT NULL,
  tool_name text NOT NULL,
  type text NOT NULL,
  serial_number text,
  location text,
  custodian text,
  condition text NOT NULL DEFAULT 'New' CHECK (condition IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  calibration_required boolean NOT NULL DEFAULT false,
  last_calibration_date date,
  next_calibration_date date,
  status text NOT NULL DEFAULT 'In Stock' CHECK (status IN ('In Stock','Issued','In Calibration','Out of Service','Lost','Retired')),
  criticality text NOT NULL DEFAULT 'Normal' CHECK (criticality IN ('Critical','High','Medium','Normal')),
  compatible_equipment text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, tool_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_tools_property ON public.uinv_tools(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_tools_status ON public.uinv_tools(status);
CREATE INDEX IF NOT EXISTS idx_uinv_tools_custodian ON public.uinv_tools(custodian);
ALTER TABLE public.uinv_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_tools" ON public.uinv_tools FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_tools" ON public.uinv_tools FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_tools TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_tool_assignments — Tool issue/return to staff
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_tool_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  tool_id text NOT NULL REFERENCES public.uinv_tools(id) ON DELETE CASCADE,
  employee text NOT NULL,
  department text,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date date,
  return_date date,
  condition_at_issue text NOT NULL DEFAULT 'New' CHECK (condition_at_issue IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  condition_at_return text CHECK (condition_at_return IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Returned','Overdue','Lost')),
  approved_by text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_tasg_tool ON public.uinv_tool_assignments(tool_id);
CREATE INDEX IF NOT EXISTS idx_uinv_tasg_status ON public.uinv_tool_assignments(status);
CREATE INDEX IF NOT EXISTS idx_uinv_tasg_employee ON public.uinv_tool_assignments(employee);
ALTER TABLE public.uinv_tool_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_tool_assignments" ON public.uinv_tool_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_tool_assignments" ON public.uinv_tool_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_tool_assignments TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_tool_calibrations — Tool calibration records
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_tool_calibrations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  tool_id text NOT NULL REFERENCES public.uinv_tools(id) ON DELETE CASCADE,
  calibration_date date NOT NULL DEFAULT CURRENT_DATE,
  next_calibration_date date,
  performed_by text,
  result text NOT NULL DEFAULT 'Pass' CHECK (result IN ('Pass','Fail','Adjusted')),
  certificate_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_tcal_tool ON public.uinv_tool_calibrations(tool_id);
CREATE INDEX IF NOT EXISTS idx_uinv_tcal_next ON public.uinv_tool_calibrations(next_calibration_date) WHERE next_calibration_date IS NOT NULL;
ALTER TABLE public.uinv_tool_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_tool_calibrations" ON public.uinv_tool_calibrations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_tool_calibrations" ON public.uinv_tool_calibrations FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_tool_calibrations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. uinv_linen_items — Linen stock master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_linen_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_code text NOT NULL,
  item_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Bed Sheets','Pillowcases','Duvets','Towels','Bath Mats','Table Linen','Pool Towels','Spa Linen','Kitchen Linen','Other')),
  size text,
  store_quantity integer NOT NULL DEFAULT 0,
  department_quantity integer NOT NULL DEFAULT 0,
  laundry_quantity integer NOT NULL DEFAULT 0,
  clean_quantity integer NOT NULL DEFAULT 0,
  dirty_quantity integer NOT NULL DEFAULT 0,
  damaged_quantity integer NOT NULL DEFAULT 0,
  lost_quantity integer NOT NULL DEFAULT 0,
  retired_quantity integer NOT NULL DEFAULT 0,
  par_level integer NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_linen_property ON public.uinv_linen_items(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_linen_category ON public.uinv_linen_items(category);
ALTER TABLE public.uinv_linen_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_linen_items" ON public.uinv_linen_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_linen_items" ON public.uinv_linen_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_linen_items TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. uinv_linen_movements — Linen movements
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_linen_movements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  linen_id text NOT NULL REFERENCES public.uinv_linen_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('Issue','Laundry Out','Laundry Return','Damage','Loss','Retirement','Transfer','Adjustment')),
  quantity integer NOT NULL DEFAULT 0,
  department text,
  reference text,
  performed_by text,
  notes text,
  movement_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_lmov_linen ON public.uinv_linen_movements(linen_id);
CREATE INDEX IF NOT EXISTS idx_uinv_lmov_date ON public.uinv_linen_movements(movement_date);
ALTER TABLE public.uinv_linen_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_linen_movements" ON public.uinv_linen_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_linen_movements" ON public.uinv_linen_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_linen_movements TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. uinv_uniform_items — Uniform stock master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_uniform_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_code text NOT NULL,
  item_name text NOT NULL,
  department text,
  role text,
  size text,
  stock_quantity integer NOT NULL DEFAULT 0,
  issued_quantity integer NOT NULL DEFAULT 0,
  par_level integer NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_uni_property ON public.uinv_uniform_items(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_uni_dept ON public.uinv_uniform_items(department);
ALTER TABLE public.uinv_uniform_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_uniform_items" ON public.uinv_uniform_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_uniform_items" ON public.uinv_uniform_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_uniform_items TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. uinv_uniform_assignments — Uniform issue to employees
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_uniform_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  uniform_id text NOT NULL REFERENCES public.uinv_uniform_items(id) ON DELETE CASCADE,
  employee text NOT NULL,
  department text,
  role text,
  size text,
  quantity integer NOT NULL DEFAULT 1,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  return_date date,
  condition text NOT NULL DEFAULT 'New' CHECK (condition IN ('New','Good','Fair','Poor','Damaged','Retired')),
  status text NOT NULL DEFAULT 'Issued' CHECK (status IN ('Issued','Returned','Replaced','Retired')),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_uasg_uniform ON public.uinv_uniform_assignments(uniform_id);
CREATE INDEX IF NOT EXISTS idx_uinv_uasg_employee ON public.uinv_uniform_assignments(employee);
CREATE INDEX IF NOT EXISTS idx_uinv_uasg_status ON public.uinv_uniform_assignments(status);
ALTER TABLE public.uinv_uniform_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_uniform_assignments" ON public.uinv_uniform_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_uniform_assignments" ON public.uinv_uniform_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_uniform_assignments TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 8. uinv_returnable_items — Returnable/consignment items master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_returnable_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_code text NOT NULL,
  item_name text NOT NULL,
  owner text NOT NULL DEFAULT 'Supplier' CHECK (owner IN ('Supplier','Hotel','Guest/Third Party')),
  owner_ref text,
  type text NOT NULL DEFAULT 'Container' CHECK (type IN ('Container','Crate','Pallet','Keg','Other')),
  quantity_on_hand integer NOT NULL DEFAULT 0,
  quantity_out integer NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_ret_property ON public.uinv_returnable_items(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ret_owner ON public.uinv_returnable_items(owner);
ALTER TABLE public.uinv_returnable_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_returnable_items" ON public.uinv_returnable_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_returnable_items" ON public.uinv_returnable_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_returnable_items TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 9. uinv_returnable_movements — Returnable item movements
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_returnable_movements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  returnable_id text NOT NULL REFERENCES public.uinv_returnable_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('Receive','Issue to Supplier','Return from Supplier','Receive from Dept','Adjustment','Scrap')),
  quantity integer NOT NULL DEFAULT 0,
  reference text,
  performed_by text,
  notes text,
  movement_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_retmov_item ON public.uinv_returnable_movements(returnable_id);
CREATE INDEX IF NOT EXISTS idx_uinv_retmov_date ON public.uinv_returnable_movements(movement_date);
ALTER TABLE public.uinv_returnable_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_returnable_movements" ON public.uinv_returnable_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_returnable_movements" ON public.uinv_returnable_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_returnable_movements TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 10. uinv_loanable_items — Loanable equipment master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_loanable_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_code text NOT NULL,
  item_name text NOT NULL,
  type text NOT NULL DEFAULT 'Portable' CHECK (type IN ('Laptop','Projector','Radio','Event Equipment','Tool','Portable Equipment','Other')),
  serial_number text,
  total_quantity integer NOT NULL DEFAULT 1,
  available_quantity integer NOT NULL DEFAULT 1,
  location text,
  custodian text,
  condition text NOT NULL DEFAULT 'New' CHECK (condition IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_uinv_loan_property ON public.uinv_loanable_items(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_loan_type ON public.uinv_loanable_items(type);
ALTER TABLE public.uinv_loanable_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_loanable_items" ON public.uinv_loanable_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_loanable_items" ON public.uinv_loanable_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_loanable_items TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 11. uinv_loan_transactions — Loan issue/return transactions
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_loan_transactions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  loan_number text NOT NULL,
  loanable_id text NOT NULL REFERENCES public.uinv_loanable_items(id) ON DELETE CASCADE,
  borrower text NOT NULL,
  department text,
  purpose text,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  return_date date,
  condition_at_issue text NOT NULL DEFAULT 'New' CHECK (condition_at_issue IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  condition_at_return text CHECK (condition_at_return IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Returned','Overdue','Lost')),
  approved_by text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_ltx_item ON public.uinv_loan_transactions(loanable_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ltx_status ON public.uinv_loan_transactions(status);
CREATE INDEX IF NOT EXISTS idx_uinv_ltx_borrower ON public.uinv_loan_transactions(borrower);
ALTER TABLE public.uinv_loan_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_loan_transactions" ON public.uinv_loan_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_loan_transactions" ON public.uinv_loan_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_loan_transactions TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 12. Seed data — demo property
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Tools
  INSERT INTO public.uinv_tools (id, property_id, tool_code, tool_name, type, serial_number, location, custodian, condition, calibration_required, last_calibration_date, next_calibration_date, status, criticality) VALUES
    ('UINV-TL-001', prop_id, 'TL-DRILL-01', 'Cordless Drill', 'Power Tool', 'DRL-BOSCH-001', 'Engineering Workshop', 'Tom Bradley', 'Good', false, NULL, NULL, 'In Stock', 'High'),
    ('UINV-TL-002', prop_id, 'TL-MULTI-01', 'Digital Multimeter', 'Testing Equipment', 'MT-FLK-001', 'Engineering Workshop', 'Tom Bradley', 'Excellent', true, '2026-01-15', '2027-01-15', 'In Stock', 'Critical')
  ON CONFLICT (id) DO NOTHING;

  -- Linen
  INSERT INTO public.uinv_linen_items (id, property_id, item_code, item_name, category, size, store_quantity, department_quantity, laundry_quantity, clean_quantity, dirty_quantity, damaged_quantity, par_level, unit_cost) VALUES
    ('UINV-LN-001', prop_id, 'LN-BED-K', 'King Bed Sheets', 'Bed Sheets', 'King', 120, 80, 40, 180, 40, 5, 200, 65.00),
    ('UINV-LN-002', prop_id, 'LN-TWL-B', 'Bath Towels', 'Towels', 'Bath', 200, 150, 60, 280, 60, 8, 300, 18.00)
  ON CONFLICT (id) DO NOTHING;

  -- Uniforms
  INSERT INTO public.uinv_uniform_items (id, property_id, item_code, item_name, department, role, size, stock_quantity, issued_quantity, par_level, unit_cost) VALUES
    ('UINV-UF-001', prop_id, 'UF-CHF-M', 'Chef Jacket', 'Food & Beverage', 'Chef', 'M', 15, 8, 20, 45.00),
    ('UINV-UF-002', prop_id, 'UF-HK-L', 'Housekeeping Uniform', 'Housekeeping', 'Housekeeper', 'L', 30, 25, 40, 38.00)
  ON CONFLICT (id) DO NOTHING;

  -- Returnables
  INSERT INTO public.uinv_returnable_items (id, property_id, item_code, item_name, owner, owner_ref, type, quantity_on_hand, quantity_out, unit_cost) VALUES
    ('UINV-RI-001', prop_id, 'RI-KEG-50', '50L Beer Keg', 'Supplier', 'Brewery Co', 'Keg', 12, 8, 150.00),
    ('UINV-RI-002', prop_id, 'RI-PAL-EU', 'Euro Pallet', 'Supplier', 'Logistics Co', 'Pallet', 40, 0, 25.00)
  ON CONFLICT (id) DO NOTHING;

  -- Loanable
  INSERT INTO public.uinv_loanable_items (id, property_id, item_code, item_name, type, serial_number, total_quantity, available_quantity, location, custodian, condition) VALUES
    ('UINV-LO-001', prop_id, 'LO-PROJ-01', 'Portable Projector', 'Projector', 'PRJ-EPSON-001', 2, 1, 'IT Store', 'IT Manager', 'Good'),
    ('UINV-LO-002', prop_id, 'LO-RAD-01', 'Walkie Talkie', 'Radio', 'RAD-MOT-001', 10, 7, 'Security Office', 'Security Manager', 'Good')
  ON CONFLICT (id) DO NOTHING;

  -- Loan transaction (one active loan of a projector)
  INSERT INTO public.uinv_loan_transactions (id, property_id, loan_number, loanable_id, borrower, department, purpose, issue_date, due_date, condition_at_issue, status, approved_by) VALUES
    ('UINV-LT-001', prop_id, 'LOAN-2026-0001', 'UINV-LO-001', 'Sales Manager', 'Sales', 'Client presentation', '2026-08-28', '2026-09-02', 'Good', 'Active', 'IT Manager')
  ON CONFLICT (id) DO NOTHING;

  -- Uniform assignment
  INSERT INTO public.uinv_uniform_assignments (id, property_id, uniform_id, employee, department, role, size, quantity, issue_date, condition, status) VALUES
    ('UINV-UA-001', prop_id, 'UINV-UF-001', 'Chef Marco', 'Food & Beverage', 'Chef', 'M', 2, '2026-01-10', 'New', 'Issued')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 13. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_tools','uinv_tool_assignments','uinv_linen_items','uinv_uniform_items','uinv_uniform_assignments','uinv_returnable_items','uinv_loanable_items','uinv_loan_transactions'];
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
