-- ============================================================
-- Finance — Fixed Assets: RLS, property scoping, lifecycle tables & seed
-- (Migration 396)
-- ============================================================
-- Brings the /erp/finance/fixed_assets tab fully online:
--   • Enables RLS + grants on the legacy fixed_assets / depreciation_schedules
--     tables (created in migration 080, which predated the RLS convention).
--   • Adds property_id to fixed_assets for multi-property scoping.
--   • Adds a unique constraint on depreciation_schedules(asset_id, fiscal_year)
--     so the ON CONFLICT upserts in the routes actually work.
--   • Creates four lifecycle tables that the FixedAssets component previously
--     rendered from hardcoded mock arrays:
--       fixed_asset_transfers
--       fixed_asset_revaluations
--       fixed_asset_verifications
--       fixed_asset_warranties
--   • Seeds demo rows for every table so the tab has data on a fresh DB.
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. RLS + grants on legacy tables
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can CRUD fixed_assets" ON public.fixed_assets;
CREATE POLICY "authenticated can CRUD fixed_assets" ON public.fixed_assets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fixed_assets" ON public.fixed_assets;
CREATE POLICY "service_role all fixed_assets" ON public.fixed_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_assets TO authenticated;

DROP POLICY IF EXISTS "authenticated can CRUD depreciation_schedules" ON public.depreciation_schedules;
CREATE POLICY "authenticated can CRUD depreciation_schedules" ON public.depreciation_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all depreciation_schedules" ON public.depreciation_schedules;
CREATE POLICY "service_role all depreciation_schedules" ON public.depreciation_schedules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.depreciation_schedules TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. property_id on fixed_assets + unique constraint on schedules
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS property_id uuid;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_property ON public.fixed_assets(property_id);

-- The calculate_depreciation() RPC and the generate-schedule route both
-- upsert on (asset_id, fiscal_year); add the constraint they assume.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_schedules_asset_id_fiscal_year_key'
  ) THEN
    ALTER TABLE public.depreciation_schedules ADD CONSTRAINT depreciation_schedules_asset_id_fiscal_year_key UNIQUE (asset_id, fiscal_year);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 3. fixed_asset_transfers
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fixed_asset_transfers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  transfer_number text,
  from_department text,
  to_department text,
  from_location text,
  to_location text,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Completed','Rejected','Cancelled')),
  approved_by text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_transfers_asset ON public.fixed_asset_transfers(asset_id);
CREATE INDEX IF NOT EXISTS idx_fa_transfers_status ON public.fixed_asset_transfers(status);
CREATE INDEX IF NOT EXISTS idx_fa_transfers_property ON public.fixed_asset_transfers(property_id);
ALTER TABLE public.fixed_asset_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD fixed_asset_transfers" ON public.fixed_asset_transfers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all fixed_asset_transfers" ON public.fixed_asset_transfers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_transfers TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. fixed_asset_revaluations
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fixed_asset_revaluations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  revaluation_number text,
  revaluation_date date NOT NULL DEFAULT CURRENT_DATE,
  original_value numeric(18,2) NOT NULL DEFAULT 0,
  revalued_value numeric(18,2) NOT NULL DEFAULT 0,
  change_percent numeric(6,2),
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_revals_asset ON public.fixed_asset_revaluations(asset_id);
CREATE INDEX IF NOT EXISTS idx_fa_revals_status ON public.fixed_asset_revaluations(status);
CREATE INDEX IF NOT EXISTS idx_fa_revals_property ON public.fixed_asset_revaluations(property_id);
ALTER TABLE public.fixed_asset_revaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD fixed_asset_revaluations" ON public.fixed_asset_revaluations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all fixed_asset_revaluations" ON public.fixed_asset_revaluations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_revaluations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. fixed_asset_verifications
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fixed_asset_verifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  verification_number text,
  verification_date date NOT NULL DEFAULT CURRENT_DATE,
  location text,
  verified_by text,
  condition text CHECK (condition IN ('Excellent','Good','Fair','Poor','Damaged')),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Verified','Discrepancy')),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_verifs_asset ON public.fixed_asset_verifications(asset_id);
CREATE INDEX IF NOT EXISTS idx_fa_verifs_status ON public.fixed_asset_verifications(status);
CREATE INDEX IF NOT EXISTS idx_fa_verifs_property ON public.fixed_asset_verifications(property_id);
ALTER TABLE public.fixed_asset_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD fixed_asset_verifications" ON public.fixed_asset_verifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all fixed_asset_verifications" ON public.fixed_asset_verifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_verifications TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. fixed_asset_warranties
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fixed_asset_warranties (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  warranty_number text,
  provider text,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  coverage text,
  contact text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fa_warranties_asset ON public.fixed_asset_warranties(asset_id);
CREATE INDEX IF NOT EXISTS idx_fa_warranties_end ON public.fixed_asset_warranties(end_date) WHERE end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fa_warranties_property ON public.fixed_asset_warranties(property_id);
ALTER TABLE public.fixed_asset_warranties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD fixed_asset_warranties" ON public.fixed_asset_warranties
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all fixed_asset_warranties" ON public.fixed_asset_warranties
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_asset_warranties TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. updated_at triggers for the new tables
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['fixed_asset_transfers','fixed_asset_revaluations','fixed_asset_verifications','fixed_asset_warranties'];
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

-- ════════════════════════════════════════════════════════════════
-- 8. Seed data — fixed_assets register
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  INSERT INTO public.fixed_assets
    (id, property_id, asset_code, asset_name, asset_category, description, location,
     purchase_date, purchase_cost, salvage_value, useful_life_years,
     depreciation_method, accumulated_depreciation, net_book_value, status)
  VALUES
    ('fa-001', prop_id, 'FA-001', 'Main Building', 'Real Estate',
     'Primary hotel building — 4 floors, 120 rooms', 'Main Site',
     '2018-01-01', 5200000, 200000, 30, 'Straight Line', 780000, 4420000, 'Active'),
    ('fa-002', prop_id, 'FA-002', 'Guest Room Furnishings', 'Furniture & Fixtures',
     'Furniture package for 120 guest rooms', 'Main Building',
     '2018-03-15', 480000, 0, 7, 'Straight Line', 205714, 274286, 'Active'),
    ('fa-003', prop_id, 'FA-003', 'Delivery Van', 'Vehicles',
     'Toyota HiAce delivery van', 'Parking Lot B',
     '2022-06-01', 45000, 5000, 5, 'Straight Line', 21000, 24000, 'Active'),
    ('fa-004', prop_id, 'FA-004', 'Kitchen Equipment', 'Machinery',
     'Commercial kitchen equipment package', 'Main Kitchen',
     '2020-09-01', 180000, 10000, 10, 'Straight Line', 68000, 112000, 'Active'),
    ('fa-005', prop_id, 'FA-005', 'Elevator System', 'Machinery',
     'Otis elevator system — 4 stops', 'Main Building',
     '2019-03-01', 220000, 10000, 15, 'Straight Line', 73333, 146667, 'Under Maintenance'),
    ('fa-006', prop_id, 'FA-006', 'Land Parcel', 'Real Estate',
     'Adjacent land parcel for future expansion', 'East Lot',
     '2017-01-01', 1200000, 1200000, 50, 'Straight Line', 0, 1200000, 'Active'),
    ('fa-007', prop_id, 'FA-007', 'Server Rack', 'IT Equipment',
     'Dell server rack with 8U servers', 'IT Room',
     '2023-01-15', 35000, 1000, 4, 'Straight Line', 8500, 26500, 'Active'),
    ('fa-008', prop_id, 'FA-008', 'Security System', 'IT Equipment',
     'CCTV + access control system', 'Main Building',
     '2023-08-01', 42000, 2000, 6, 'Straight Line', 7000, 35000, 'Active'),
    ('fa-009', prop_id, 'FA-009', 'Banquet Furniture', 'Furniture & Fixtures',
     'Round tables and chairs for banquet hall', 'Banquet Hall',
     '2021-05-01', 38000, 0, 8, 'Straight Line', 14250, 23750, 'Active'),
    ('fa-010', prop_id, 'FA-010', 'HVAC System', 'Machinery',
     'Central HVAC plant — rooftop unit', 'Rooftop',
     '2021-09-01', 285000, 15000, 15, 'Straight Line', 57000, 228000, 'Active'),
    ('fa-011', prop_id, 'FA-011', 'Generator', 'Machinery',
     'Caterpillar 250kVA backup generator', 'Generator Room',
     '2022-11-01', 65000, 3000, 10, 'Straight Line', 13000, 52000, 'Active'),
    ('fa-012', prop_id, 'FA-012', 'Conference Table', 'Furniture & Fixtures',
     'Oak conference table — seats 16', 'Banquet Hall',
     '2021-02-01', 12000, 0, 10, 'Straight Line', 4500, 7500, 'Active')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 9. Seed data — transfers
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  INSERT INTO public.fixed_asset_transfers
    (id, property_id, asset_id, transfer_number, from_department, to_department, from_location, to_location, transfer_date, status, reason)
  VALUES
    ('fat-001', prop_id, 'fa-003', 'AT-2024-001', 'Front Office', 'F&B Division', 'Front Office', 'F&B Storage', '2024-05-15', 'Completed', 'Reassigned for F&B deliveries'),
    ('fat-002', prop_id, 'fa-007', 'AT-2024-002', 'IT Dept', 'Finance Dept', 'IT Room', 'Finance Office', '2024-05-20', 'Completed', 'Finance server consolidation'),
    ('fat-003', prop_id, 'fa-012', 'AT-2024-003', 'Banquet Hall', 'Executive Office', 'Banquet Hall', 'Executive Boardroom', '2024-06-01', 'Pending', 'Executive office refurnishing')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 10. Seed data — revaluations
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  INSERT INTO public.fixed_asset_revaluations
    (id, property_id, asset_id, revaluation_number, revaluation_date, original_value, revalued_value, change_percent, status, reason)
  VALUES
    ('far-001', prop_id, 'fa-001', 'RV-2024-001', '2024-04-01', 5200000, 5800000, 11.54, 'Approved', 'Market appreciation — independent valuation'),
    ('far-002', prop_id, 'fa-004', 'RV-2024-002', '2024-03-15', 180000, 165000, -8.33, 'Approved', 'Wear and tear — impairment review'),
    ('far-003', prop_id, 'fa-006', 'RV-2024-003', '2024-05-10', 1200000, 1450000, 20.83, 'Approved', 'Land value increase — comparable sales')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 11. Seed data — verifications
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  INSERT INTO public.fixed_asset_verifications
    (id, property_id, asset_id, verification_number, verification_date, location, verified_by, condition, status)
  VALUES
    ('fav-001', prop_id, 'fa-001', 'VF-2024-001', '2024-05-01', 'Main Site', 'James B.', 'Excellent', 'Verified'),
    ('fav-002', prop_id, 'fa-003', 'VF-2024-002', '2024-05-05', 'Parking Lot B', 'Sarah T.', 'Good', 'Verified'),
    ('fav-003', prop_id, 'fa-007', 'VF-2024-003', '2024-05-10', 'IT Room', 'Mike K.', 'Good', 'Verified'),
    ('fav-004', prop_id, 'fa-012', 'VF-2024-004', '2024-06-01', 'Banquet Hall', 'Lisa M.', 'Fair', 'Pending')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 12. Seed data — warranties
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  INSERT INTO public.fixed_asset_warranties
    (id, property_id, asset_id, warranty_number, provider, start_date, end_date, coverage, contact)
  VALUES
    ('faw-001', prop_id, 'fa-007', 'WR-DELL-001', 'Dell Technologies', '2023-01-15', '2026-01-15', 'Parts & Labour', '1-800-DELL'),
    ('faw-002', prop_id, 'fa-003', 'WR-TOY-001', 'Toyota Ethiopia', '2022-06-01', '2025-06-01', 'Powertrain 3yr/100k km', '+251-11-555-0100'),
    ('faw-003', prop_id, 'fa-010', 'WR-CLI-001', 'Climate Control Co.', '2021-09-01', '2024-09-01', 'Compressor & Parts', '+1-555-0200'),
    ('faw-004', prop_id, 'fa-005', 'WR-OTIS-001', 'Otis Elevators', '2020-03-01', '2024-03-01', 'Parts & Maintenance', '+1-555-0300'),
    ('faw-005', prop_id, 'fa-008', 'WR-SEC-001', 'SecureTech Ltd.', '2023-08-01', '2026-08-01', 'Full System Coverage', '+1-555-0400'),
    ('faw-006', prop_id, 'fa-011', 'WR-CAT-001', 'Caterpillar', '2022-11-01', '2025-11-01', 'Engine & Alternator', '+1-555-0500')
  ON CONFLICT (id) DO NOTHING;
END $$;
