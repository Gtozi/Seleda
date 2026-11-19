-- ============================================================
-- Unified Inventory & Stores Portal — Gap Filler Tables (Migration 368)
-- ============================================================
-- Implements spec sections:
--   S49 — Guest / Third-Party Custody Register
--   S51 — Critical Spare Parts classification
--   S52 — Equipment Compatibility (spare part <-> asset)
--   S75 — Store Opening & Closing checklists
--
-- All tables use the uinv_* namespace, RLS enabled, authenticated
-- role granted CRUD, service_role full access.
-- ============================================================

-- 1. uinv_critical_spares — Critical spare parts classification
CREATE TABLE IF NOT EXISTS public.uinv_critical_spares (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  criticality text NOT NULL DEFAULT 'Normal' CHECK (criticality IN ('Critical','High','Medium','Normal')),
  min_stock numeric(12,3) NOT NULL DEFAULT 0,
  lead_time_days integer NOT NULL DEFAULT 0,
  alternative_part_id text REFERENCES public.uinv_items(id) ON DELETE SET NULL,
  emergency_availability text,
  compatible_equipment text[],
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id)
);
CREATE INDEX IF NOT EXISTS idx_uinv_cs_item ON public.uinv_critical_spares(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_cs_criticality ON public.uinv_critical_spares(criticality);
ALTER TABLE public.uinv_critical_spares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_critical_spares" ON public.uinv_critical_spares FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_critical_spares" ON public.uinv_critical_spares FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_critical_spares TO authenticated;

-- 2. uinv_equipment_compatibility — Spare part <-> asset compatibility
CREATE TABLE IF NOT EXISTS public.uinv_equipment_compatibility (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  compatibility_notes text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_uinv_ec_item ON public.uinv_equipment_compatibility(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ec_asset ON public.uinv_equipment_compatibility(asset_id);
ALTER TABLE public.uinv_equipment_compatibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_equipment_compatibility" ON public.uinv_equipment_compatibility FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_equipment_compatibility" ON public.uinv_equipment_compatibility FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_equipment_compatibility TO authenticated;

-- 3. uinv_guest_custody — Guest / third-party custody register
CREATE TABLE IF NOT EXISTS public.uinv_guest_custody (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  custody_number text NOT NULL,
  owner_name text NOT NULL,
  owner_type text NOT NULL DEFAULT 'Guest' CHECK (owner_type IN ('Guest','Third Party','Supplier','Vendor','Other')),
  item_description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  location text,
  custodian text,
  condition text NOT NULL DEFAULT 'Good' CHECK (condition IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  release_authorization text,
  release_date date,
  released_to text,
  released_by text,
  status text NOT NULL DEFAULT 'In Custody' CHECK (status IN ('In Custody','Released','Transferred','Disposed')),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_gc_property ON public.uinv_guest_custody(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_gc_status ON public.uinv_guest_custody(status);
CREATE INDEX IF NOT EXISTS idx_uinv_gc_owner ON public.uinv_guest_custody(owner_name);
ALTER TABLE public.uinv_guest_custody ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_guest_custody" ON public.uinv_guest_custody FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_guest_custody" ON public.uinv_guest_custody FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_guest_custody TO authenticated;

-- 4. uinv_store_sessions — Store opening & closing checklists
CREATE TABLE IF NOT EXISTS public.uinv_store_sessions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  store_id text NOT NULL REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  session_type text NOT NULL CHECK (session_type IN ('Opening','Closing')),
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  performed_by text NOT NULL,
  temperature_checked boolean NOT NULL DEFAULT false,
  temperature_reading numeric(5,2),
  security_checked boolean NOT NULL DEFAULT false,
  cold_room_checked boolean NOT NULL DEFAULT false,
  pending_transactions_reviewed boolean NOT NULL DEFAULT false,
  stock_exceptions_reviewed boolean NOT NULL DEFAULT false,
  high_value_secured boolean NOT NULL DEFAULT false,
  receipts_completed boolean NOT NULL DEFAULT false,
  issues_completed boolean NOT NULL DEFAULT false,
  transfers_reviewed boolean NOT NULL DEFAULT false,
  returns_reviewed boolean NOT NULL DEFAULT false,
  expiry_reviewed boolean NOT NULL DEFAULT false,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  exceptions text,
  status text NOT NULL DEFAULT 'Completed' CHECK (status IN ('In Progress','Completed','Exceptions Noted')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_ss_store ON public.uinv_store_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ss_date ON public.uinv_store_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_uinv_ss_type ON public.uinv_store_sessions(session_type);
ALTER TABLE public.uinv_store_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_store_sessions" ON public.uinv_store_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_store_sessions" ON public.uinv_store_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_store_sessions TO authenticated;

-- 5. Seed data
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Critical spare: LED bulb for HVAC
  INSERT INTO public.uinv_critical_spares (id, property_id, item_id, criticality, min_stock, lead_time_days, emergency_availability, compatible_equipment, notes) VALUES
    ('UINV-CS-001', prop_id, 'UINV-IT-006', 'High', 100, 7, 'Local supplier emergency stock', ARRAY['HVAC Main Unit','Guest Room Lighting'], 'Critical for guest room maintenance')
  ON CONFLICT (id) DO NOTHING;

  -- Equipment compatibility: LED bulb <-> HVAC asset
  INSERT INTO public.uinv_equipment_compatibility (id, property_id, item_id, asset_id, compatibility_notes, is_primary) VALUES
    ('UINV-EC-001', prop_id, 'UINV-IT-006', 'UINV-AS-004', 'Used for HVAC control panel indicator lights', false)
  ON CONFLICT (id) DO NOTHING;

  -- Guest custody: VIP guest luggage held
  INSERT INTO public.uinv_guest_custody (id, property_id, custody_number, owner_name, owner_type, item_description, quantity, received_date, location, custodian, condition, status, notes) VALUES
    ('UINV-GC-001', prop_id, 'CUST-2026-0001', 'Mr. John Smith', 'Guest', 'VIP Luggage - 2 suitcases', 2, '2026-08-28', 'Bell Desk Storage', 'Bell Captain', 'Good', 'In Custody', 'Guest requested storage until checkout on 2026-09-02')
  ON CONFLICT (id) DO NOTHING;

  -- Store sessions: opening and closing for food store
  INSERT INTO public.uinv_store_sessions (id, property_id, store_id, session_type, session_date, performed_by, temperature_checked, temperature_reading, security_checked, cold_room_checked, pending_transactions_reviewed, stock_exceptions_reviewed, status, notes) VALUES
    ('UINV-SS-001', prop_id, 'UINV-ST-FOOD', 'Opening', '2026-08-30', 'John Storekeeper', true, 3.5, true, true, true, false, 'Completed', 'Cold store temp normal'),
    ('UINV-SS-002', prop_id, 'UINV-ST-FOOD', 'Closing', '2026-08-30', 'John Storekeeper', true, 4.0, true, true, true, true, 'Completed', 'All transactions completed, high-value items secured')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 6. updated_at triggers
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_critical_spares','uinv_guest_custody','uinv_store_sessions'];
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
