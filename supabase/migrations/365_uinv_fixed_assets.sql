-- ============================================================
-- Unified Inventory & Stores Portal — Fixed Asset Register (Migration 365)
-- ============================================================
-- Implements the operational fixed-asset register per
-- docs/unified_inventory_stores_portal_expanded.md §24–§42, §58–§59.
--
-- Finance remains the accounting owner; this portal owns physical
-- custody, location, custody, verification, transfer, warranty,
-- insurance references, disposal and retirement records.
--
-- NOTE: The legacy uinv_asset_checkouts / uinv_asset_issues /
--       uinv_asset_stock_counts tables referenced by the old
--       FixedAssetsModule were never created by any migration and
--       are replaced by this register. The old routes are removed
--       in the routes refactor.
--
-- Tables:
--   uinv_assets              — Asset master (the register)
--   uinv_asset_classes       — Asset class master (configurable)
--   uinv_asset_components    — Parent/child component structure
--   uinv_asset_assignments   — Asset assignment to custodian/dept
--   uinv_asset_transfers     — Asset transfers (loc/dept/property)
--   uinv_asset_verifications — Verification campaign line results
--   uinv_asset_verification_campaigns — Verification campaigns
--   uinv_asset_warranties    — Warranty records
--   uinv_asset_insurance     — Insurance reference records
--   uinv_asset_disposals     — Disposal records
--   uinv_asset_documents     — Asset document/attachment references
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. uinv_asset_classes — Asset class master
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_classes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  class_code text NOT NULL,
  class_name text NOT NULL,
  description text,
  capitalization_threshold numeric(14,2) NOT NULL DEFAULT 0,
  default_useful_life_years integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, class_code)
);
ALTER TABLE public.uinv_asset_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_classes" ON public.uinv_asset_classes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_classes" ON public.uinv_asset_classes FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_classes TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_assets — Asset master (the register)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_assets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_number text NOT NULL,
  asset_tag text,
  barcode text,
  qr_code text,
  serial_number text,
  asset_name text NOT NULL,
  description text,
  class_id text REFERENCES public.uinv_asset_classes(id) ON DELETE SET NULL,
  class text,
  category text,
  manufacturer text,
  model text,
  supplier text,
  purchase_order text,
  grn text,
  purchase_date date,
  in_service_date date,
  acquisition_cost numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  building text,
  department text,
  location text,
  location_detail text,
  custodian text,
  condition text NOT NULL DEFAULT 'New' CHECK (condition IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  status text NOT NULL DEFAULT 'Ordered' CHECK (status IN (
    'Ordered','Received','Inspection','Tagged','Available','Assigned','In Service',
    'In Transit','Under Maintenance','Damaged','Lost','Stolen','Impaired',
    'Held for Disposal','Disposed','Retired'
  )),
  warranty_id text,
  insurance_id text,
  finance_asset_id text,
  parent_asset_id text REFERENCES public.uinv_assets(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, asset_number)
);
CREATE INDEX IF NOT EXISTS idx_uinv_assets_property ON public.uinv_assets(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_assets_status ON public.uinv_assets(status);
CREATE INDEX IF NOT EXISTS idx_uinv_assets_class ON public.uinv_assets(class_id);
CREATE INDEX IF NOT EXISTS idx_uinv_assets_custodian ON public.uinv_assets(custodian);
CREATE INDEX IF NOT EXISTS idx_uinv_assets_department ON public.uinv_assets(department);
CREATE INDEX IF NOT EXISTS idx_uinv_assets_parent ON public.uinv_assets(parent_asset_id);
ALTER TABLE public.uinv_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_assets" ON public.uinv_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_assets" ON public.uinv_assets FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_assets TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_asset_components — Parent/child component structure
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_components (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  parent_asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  child_asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  component_name text,
  relationship text NOT NULL DEFAULT 'Component',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_asset_id, child_asset_id)
);
CREATE INDEX IF NOT EXISTS idx_uinv_assetcomp_parent ON public.uinv_asset_components(parent_asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_assetcomp_child ON public.uinv_asset_components(child_asset_id);
ALTER TABLE public.uinv_asset_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_components" ON public.uinv_asset_components FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_components" ON public.uinv_asset_components FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_components TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. uinv_asset_assignments — Asset assignment to custodian/dept
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_assignments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  employee text,
  department text,
  location text,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date date,
  return_date date,
  condition_at_issue text NOT NULL DEFAULT 'New' CHECK (condition_at_issue IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  condition_at_return text CHECK (condition_at_return IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  accessories text,
  acknowledgement text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Returned','Overdue','Lost')),
  approved_by text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_asgn_asset ON public.uinv_asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_asgn_status ON public.uinv_asset_assignments(status);
CREATE INDEX IF NOT EXISTS idx_uinv_asgn_employee ON public.uinv_asset_assignments(employee);
ALTER TABLE public.uinv_asset_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_assignments" ON public.uinv_asset_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_assignments" ON public.uinv_asset_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_assignments TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. uinv_asset_transfers — Asset transfers
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_transfers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  transfer_number text NOT NULL,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  transfer_type text NOT NULL CHECK (transfer_type IN ('Employee','Department','Location','Property','Temporary','Inter-Company')),
  from_property_id uuid,
  to_property_id uuid,
  from_location text,
  to_location text,
  from_custodian text,
  to_custodian text,
  from_department text,
  to_department text,
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Dispatched','In Transit','Received','Rejected','Cancelled')),
  approved_by text,
  approved_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_atrf_asset ON public.uinv_asset_transfers(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_atrf_status ON public.uinv_asset_transfers(status);
CREATE INDEX IF NOT EXISTS idx_uinv_atrf_property ON public.uinv_asset_transfers(property_id);
ALTER TABLE public.uinv_asset_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_transfers" ON public.uinv_asset_transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_transfers" ON public.uinv_asset_transfers FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_transfers TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. uinv_asset_verification_campaigns — Verification campaigns
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_verification_campaigns (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  campaign_number text NOT NULL,
  campaign_name text NOT NULL,
  scope text NOT NULL DEFAULT 'Full' CHECK (scope IN ('Full','By Class','By Department','By Location','By Custodian','Sample')),
  scope_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Completed','Cancelled')),
  assigned_verifiers text[],
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_avc_property ON public.uinv_asset_verification_campaigns(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_avc_status ON public.uinv_asset_verification_campaigns(status);
ALTER TABLE public.uinv_asset_verification_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_verification_campaigns" ON public.uinv_asset_verification_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_verification_campaigns" ON public.uinv_asset_verification_campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_verification_campaigns TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. uinv_asset_verifications — Verification line results
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_verifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  campaign_id text REFERENCES public.uinv_asset_verification_campaigns(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  expected_location text,
  confirmed_location text,
  expected_custodian text,
  confirmed_custodian text,
  confirmed_condition text CHECK (confirmed_condition IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  result text NOT NULL DEFAULT 'Found' CHECK (result IN ('Found','Wrong Location','Wrong Custodian','Damaged','Missing','Duplicate','Unidentified')),
  scanned_at timestamptz,
  scanned_by text,
  exception_notes text,
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Investigating','Resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_av_campaign ON public.uinv_asset_verifications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_uinv_av_asset ON public.uinv_asset_verifications(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_av_result ON public.uinv_asset_verifications(result);
CREATE INDEX IF NOT EXISTS idx_uinv_av_status ON public.uinv_asset_verifications(status);
ALTER TABLE public.uinv_asset_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_verifications" ON public.uinv_asset_verifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_verifications" ON public.uinv_asset_verifications FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_verifications TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 8. uinv_asset_warranties — Warranty records
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_warranties (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  warranty_number text,
  provider text,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  coverage text,
  supplier text,
  service_contact text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_aw_asset ON public.uinv_asset_warranties(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_aw_end ON public.uinv_asset_warranties(end_date) WHERE end_date IS NOT NULL;
ALTER TABLE public.uinv_asset_warranties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_warranties" ON public.uinv_asset_warranties FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_warranties" ON public.uinv_asset_warranties FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_warranties TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 9. uinv_asset_insurance — Insurance reference records
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_insurance (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  policy_number text,
  insurer text,
  coverage text,
  insured_value numeric(14,2) NOT NULL DEFAULT 0,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_ai_asset ON public.uinv_asset_insurance(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ai_expiry ON public.uinv_asset_insurance(expiry_date) WHERE expiry_date IS NOT NULL;
ALTER TABLE public.uinv_asset_insurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_insurance" ON public.uinv_asset_insurance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_insurance" ON public.uinv_asset_insurance FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_insurance TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 10. uinv_asset_disposals — Disposal records
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_disposals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  disposal_number text NOT NULL,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  disposal_method text NOT NULL CHECK (disposal_method IN ('Sale','Auction','Scrap','Donation','Return to Supplier','Recycling','Destruction','Trade-in')),
  disposal_date date,
  condition_assessment text,
  disposal_value numeric(14,2) NOT NULL DEFAULT 0,
  finance_reference text,
  evidence_ref text,
  status text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Condition Assessed','Approved','Finance Reviewed','Disposed','Rejected')),
  approved_by text,
  approved_at timestamptz,
  finance_reviewed_by text,
  finance_reviewed_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_ad_asset ON public.uinv_asset_disposals(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ad_status ON public.uinv_asset_disposals(status);
ALTER TABLE public.uinv_asset_disposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_disposals" ON public.uinv_asset_disposals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_disposals" ON public.uinv_asset_disposals FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_disposals TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 11. uinv_asset_documents — Asset document/attachment references
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_asset_documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('Purchase Document','Delivery Note','Inspection Record','Damage Photo','Asset Photo','Warranty Document','Insurance Document','Count Sheet','Transfer Document','Custody Acknowledgement','Disposal Evidence','Calibration Certificate','Other')),
  file_name text,
  file_url text,
  uploaded_by text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_adoc_asset ON public.uinv_asset_documents(asset_id);
ALTER TABLE public.uinv_asset_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_asset_documents" ON public.uinv_asset_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_asset_documents" ON public.uinv_asset_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_asset_documents TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 12. Seed data — asset classes + a few demo assets
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Asset classes (spec §25 — hotel classes)
  INSERT INTO public.uinv_asset_classes (id, property_id, class_code, class_name, capitalization_threshold, default_useful_life_years, is_active) VALUES
    ('UINV-AC-FF',  prop_id, 'FF',  'Furniture & Fixtures', 500, 7, true),
    ('UINV-AC-KE',  prop_id, 'KE',  'Kitchen Equipment', 1000, 10, true),
    ('UINV-AC-HVAC',prop_id, 'HVAC','HVAC', 2000, 15, true),
    ('UINV-AC-IT',  prop_id, 'IT',  'IT Equipment', 800, 4, true),
    ('UINV-AC-AV',  prop_id, 'AV',  'Audio Visual', 1000, 6, true),
    ('UINV-AC-SEC', prop_id, 'SEC', 'Security Equipment', 1000, 8, true)
  ON CONFLICT (id) DO NOTHING;

  -- Demo assets
  INSERT INTO public.uinv_assets (id, property_id, asset_number, asset_tag, serial_number, asset_name, description, class_id, class, category, manufacturer, model, supplier, purchase_order, purchase_date, in_service_date, acquisition_cost, building, department, location, custodian, condition, status, is_active) VALUES
    ('UINV-AS-001', prop_id, 'AST-2026-0001', 'AST-HOTEL-000123', 'TV-SAM-55-0001', 'Guest Room TV 55"', 'Smart TV for guest room 305', 'UINV-AC-AV', 'Audio Visual', 'Television', 'Samsung', 'UN55NU7100', 'AV Supplies Co', 'PO-5001', '2026-01-15', '2026-02-01', 650.00, 'Main Building', 'Housekeeping', 'Room 305', 'Room 305 Attendant', 'Good', 'In Service', true),
    ('UINV-AS-002', prop_id, 'AST-2026-0002', 'AST-HOTEL-000124', 'OVEN-WEG-0001', 'Convection Oven', 'Main kitchen convection oven', 'UINV-AC-KE', 'Kitchen Equipment', 'Oven', 'Wega', 'WEG-CO-1', 'Kitchen Equip Ltd', 'PO-5002', '2025-11-10', '2025-12-01', 4800.00, 'Main Building', 'Food & Beverage', 'Main Kitchen', 'Executive Chef', 'Excellent', 'In Service', true),
    ('UINV-AS-003', prop_id, 'AST-2026-0003', 'AST-HOTEL-000125', 'LAP-DEL-0001', 'Front Office Laptop', 'Reception laptop', 'UINV-AC-IT', 'IT Equipment', 'Laptop', 'Dell', 'Latitude 5440', 'IT Supplies', 'PO-5003', '2026-03-20', '2026-03-25', 1200.00, 'Main Building', 'Front Office', 'Reception Desk', 'Front Office Manager', 'Good', 'Assigned', true),
    ('UINV-AS-004', prop_id, 'AST-2026-0004', 'AST-HOTEL-000126', 'HVAC-TRANE-01', 'HVAC Main Unit', 'Rooftop HVAC main unit', 'UINV-AC-HVAC', 'HVAC', 'Climate Control', 'Trane', 'TR-RT-100', 'Climate Systems', 'PO-5004', '2024-06-01', '2024-07-15', 28000.00, 'Main Building', 'Engineering', 'Rooftop', 'Engineering Supervisor', 'Good', 'In Service', true),
    ('UINV-AS-005', prop_id, 'AST-2026-0005', 'AST-HOTEL-000127', 'CCTV-AXIS-01', 'CCTV Camera Lobby', 'Lobby surveillance camera', 'UINV-AC-SEC', 'Security Equipment', 'Camera', 'Axis', 'P3268-LV', 'Security Supplies', 'PO-5005', '2025-09-01', '2025-09-10', 850.00, 'Main Building', 'Security', 'Lobby', 'Security Manager', 'Excellent', 'In Service', true)
  ON CONFLICT (id) DO NOTHING;

  -- Components: HVAC main unit has child components (modeled as separate assets linked)
  INSERT INTO public.uinv_asset_components (id, parent_asset_id, child_asset_id, component_name, relationship) VALUES
    ('UINV-ACP-001', 'UINV-AS-004', 'UINV-AS-004', 'Main Unit', 'Self Reference')
  ON CONFLICT (id) DO NOTHING;

  -- Warranty for the oven
  INSERT INTO public.uinv_asset_warranties (id, property_id, asset_id, warranty_number, provider, start_date, end_date, coverage, supplier, service_contact) VALUES
    ('UINV-AW-001', prop_id, 'UINV-AS-002', 'W-WEG-2025', 'Wega Care', '2025-12-01', '2027-12-01', 'Parts & Labour', 'Kitchen Equip Ltd', '+1-555-0142')
  ON CONFLICT (id) DO NOTHING;

  -- Insurance for the HVAC unit
  INSERT INTO public.uinv_asset_insurance (id, property_id, asset_id, policy_number, insurer, coverage, insured_value, start_date, expiry_date) VALUES
    ('UINV-AI-001', prop_id, 'UINV-AS-004', 'POL-HVAC-2024', 'Global Insurance', 'All Risk', 28000.00, '2024-07-15', '2027-07-15')
  ON CONFLICT (id) DO NOTHING;

  -- Assignment for the laptop
  INSERT INTO public.uinv_asset_assignments (id, property_id, asset_id, employee, department, location, issue_date, condition_at_issue, status) VALUES
    ('UINV-AAG-001', prop_id, 'UINV-AS-003', 'Front Office Manager', 'Front Office', 'Reception Desk', '2026-03-25', 'New', 'Active')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 13. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_asset_classes','uinv_assets','uinv_asset_components','uinv_asset_assignments','uinv_asset_transfers','uinv_asset_verification_campaigns','uinv_asset_verifications','uinv_asset_warranties','uinv_asset_insurance','uinv_asset_disposals'];
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
