-- ============================================================
-- Unified Inventory & Stores Portal — Storekeeping Expansion (Migration 364)
-- ============================================================
-- Adds the storekeeping-flow tables missing from migration 346:
--   uinv_putaway_tasks    — Put-away tasks (receipt → storage location)
--   uinv_picking_tasks    — Picking tasks (issue/transfer → picked stock)
--   uinv_returns          — Stock returns header + JSONB lines
--   uinv_quarantine       — Quarantined stock register
--   uinv_serials          — Serial-number tracking (equipment / high-value)
--   uinv_lots             — Lot tracking (distinct from batches for lot-only items)
--   uinv_temperature_logs — Temperature-controlled store readings
--   uinv_chemicals        — Chemical inventory metadata (SDS, handlers)
--
-- All tables use the `uinv_*` namespace, RLS enabled, `authenticated`
-- role granted CRUD, `service_role` full access — matching migration 346.
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. uinv_putaway_tasks — Put-away tasks
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_putaway_tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  putaway_number text NOT NULL,
  grn_id text REFERENCES public.uinv_goods_receipts(id) ON DELETE SET NULL,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  from_location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  to_location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'PCS',
  recommended_location text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Put Away','Cancelled')),
  putaway_by text,
  putaway_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_putaway_property ON public.uinv_putaway_tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_putaway_status ON public.uinv_putaway_tasks(status);
CREATE INDEX IF NOT EXISTS idx_uinv_putaway_grn ON public.uinv_putaway_tasks(grn_id);
ALTER TABLE public.uinv_putaway_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_putaway_tasks" ON public.uinv_putaway_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_putaway_tasks" ON public.uinv_putaway_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_putaway_tasks TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_picking_tasks — Picking tasks
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_picking_tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  picking_number text NOT NULL,
  source_type text NOT NULL DEFAULT 'Issue' CHECK (source_type IN ('Issue','Transfer','Reservation','Production')),
  source_id text,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  serial_id text,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'PCS',
  pick_strategy text NOT NULL DEFAULT 'FIFO' CHECK (pick_strategy IN ('FIFO','FEFO','LIFO','Manual')),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Picked','Short','Cancelled')),
  picked_by text,
  picked_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_picking_property ON public.uinv_picking_tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_picking_status ON public.uinv_picking_tasks(status);
CREATE INDEX IF NOT EXISTS idx_uinv_picking_source ON public.uinv_picking_tasks(source_id);
ALTER TABLE public.uinv_picking_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_picking_tasks" ON public.uinv_picking_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_picking_tasks" ON public.uinv_picking_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_picking_tasks TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_returns — Stock returns (header + JSONB lines)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_returns (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  return_number text NOT NULL,
  issue_id text REFERENCES public.uinv_issues(id) ON DELETE SET NULL,
  department text,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  return_date date NOT NULL DEFAULT CURRENT_DATE,
  received_by text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_value numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Received','Inspected','Restocked','Quarantined','Rejected')),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_returns_property ON public.uinv_returns(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_returns_status ON public.uinv_returns(status);
CREATE INDEX IF NOT EXISTS idx_uinv_returns_issue ON public.uinv_returns(issue_id);
ALTER TABLE public.uinv_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_returns" ON public.uinv_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_returns" ON public.uinv_returns FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_returns TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. uinv_quarantine — Quarantined stock register
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_quarantine (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  quarantine_number text NOT NULL,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'PCS',
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'Receiving' CHECK (source IN ('Receiving','Return','Damage','Inspection','Expiry','Other')),
  source_ref text,
  quarantined_by text,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'Held' CHECK (status IN ('Held','Released','Rejected','Disposed','Returned to Supplier')),
  release_destination text,
  released_by text,
  released_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_quarantine_property ON public.uinv_quarantine(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_quarantine_status ON public.uinv_quarantine(status);
CREATE INDEX IF NOT EXISTS idx_uinv_quarantine_item ON public.uinv_quarantine(item_id);
ALTER TABLE public.uinv_quarantine ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_quarantine" ON public.uinv_quarantine FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_quarantine" ON public.uinv_quarantine FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_quarantine TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. uinv_serials — Serial-number tracking
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_serials (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  serial_number text NOT NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  grn_id text REFERENCES public.uinv_goods_receipts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'In Stock' CHECK (status IN ('In Stock','Issued','In Transit','Quarantined','Damaged','Lost','Retired')),
  custodian text,
  condition text NOT NULL DEFAULT 'New' CHECK (condition IN ('New','Excellent','Good','Fair','Poor','Damaged','Unusable')),
  acquired_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, serial_number)
);
CREATE INDEX IF NOT EXISTS idx_uinv_serials_item ON public.uinv_serials(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_serials_status ON public.uinv_serials(status);
CREATE INDEX IF NOT EXISTS idx_uinv_serials_store ON public.uinv_serials(store_id);
ALTER TABLE public.uinv_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_serials" ON public.uinv_serials FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_serials" ON public.uinv_serials FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_serials TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. uinv_lots — Lot tracking (distinct from batches)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_lots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  lot_number text NOT NULL,
  manufacturing_date date,
  expiry_date date,
  received_date date,
  supplier text,
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  status public.uinv_stock_status NOT NULL DEFAULT 'Available',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_lots_item ON public.uinv_lots(item_id);
CREATE INDEX IF NOT EXISTS idx_uinv_lots_expiry ON public.uinv_lots(expiry_date) WHERE expiry_date IS NOT NULL;
ALTER TABLE public.uinv_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_lots" ON public.uinv_lots FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_lots" ON public.uinv_lots FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_lots TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. uinv_temperature_logs — Temperature-controlled store readings
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_temperature_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  store_id text NOT NULL REFERENCES public.uinv_stores(id) ON DELETE CASCADE,
  location_id text REFERENCES public.uinv_locations(id) ON DELETE SET NULL,
  required_min numeric(5,2),
  required_max numeric(5,2),
  actual_temp numeric(5,2) NOT NULL,
  unit text NOT NULL DEFAULT 'C',
  reading_time timestamptz NOT NULL DEFAULT now(),
  recorded_by text,
  status text NOT NULL DEFAULT 'OK' CHECK (status IN ('OK','Exception','Critical')),
  corrective_action text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_templog_store ON public.uinv_temperature_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_uinv_templog_time ON public.uinv_temperature_logs(reading_time);
CREATE INDEX IF NOT EXISTS idx_uinv_templog_status ON public.uinv_temperature_logs(status);
ALTER TABLE public.uinv_temperature_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_temperature_logs" ON public.uinv_temperature_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_temperature_logs" ON public.uinv_temperature_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_temperature_logs TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 8. uinv_chemicals — Chemical inventory metadata
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_chemicals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  item_id text NOT NULL REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  classification text NOT NULL,
  storage_requirement text,
  sds_reference text,
  authorized_handlers text[],
  hazard_level text NOT NULL DEFAULT 'Medium' CHECK (hazard_level IN ('Low','Medium','High','Very High')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id)
);
CREATE INDEX IF NOT EXISTS idx_uinv_chemicals_item ON public.uinv_chemicals(item_id);
ALTER TABLE public.uinv_chemicals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_chemicals" ON public.uinv_chemicals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_chemicals" ON public.uinv_chemicals FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_chemicals TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 9. Seed data — demo property
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Put-away tasks (one pending from GRN-002, one completed from GRN-001)
  INSERT INTO public.uinv_putaway_tasks (id, property_id, putaway_number, grn_id, item_id, store_id, to_location_id, batch_id, quantity, unit, recommended_location, status, putaway_by, putaway_at) VALUES
    ('UINV-PA-001', prop_id, 'PA-2026-0001', 'UINV-GRN-001', 'UINV-IT-001', 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 'UINV-BT-001', 120, 'kg', 'Cold Storage 1', 'Put Away', 'John Storekeeper', '2026-08-01 11:00:00+00'),
    ('UINV-PA-002', prop_id, 'PA-2026-0002', 'UINV-GRN-002', 'UINV-IT-006', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', NULL, 50, 'pcs', 'ENG Shelf 1', 'Pending', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Picking tasks (one picked for ISS-001, one pending for ISS-003)
  INSERT INTO public.uinv_picking_tasks (id, property_id, picking_number, source_type, source_id, item_id, store_id, location_id, batch_id, quantity, unit, pick_strategy, status, picked_by, picked_at) VALUES
    ('UINV-PK-001', prop_id, 'PK-2026-0001', 'Issue', 'UINV-IS-001', 'UINV-IT-004', 'UINV-ST-HK', 'UINV-LOC-HK-1', NULL, 200, 'pcs', 'FIFO', 'Picked', 'John Storekeeper', '2026-08-15 08:45:00+00'),
    ('UINV-PK-002', prop_id, 'PK-2026-0002', 'Issue', 'UINV-IS-003', 'UINV-IT-006', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', NULL, 20, 'pcs', 'FIFO', 'Pending', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Returns (one received from Housekeeping)
  INSERT INTO public.uinv_returns (id, property_id, return_number, issue_id, department, store_id, return_date, received_by, lines, total_value, status) VALUES
    ('UINV-RT-001', prop_id, 'RET-2026-0001', 'UINV-IS-001', 'Housekeeping', 'UINV-ST-HK', '2026-08-20', 'John Storekeeper',
      '[{"itemId":"UINV-IT-004","itemName":"Luxury Shampoo 30ml","quantity":15,"unit":"pcs","condition":"Good","reason":"Over-issued","unitCost":1.20,"value":18.00}]'::jsonb,
      18.00, 'Restocked')
  ON CONFLICT (id) DO NOTHING;

  -- Quarantine (one held from receiving inspection)
  INSERT INTO public.uinv_quarantine (id, property_id, quarantine_number, item_id, store_id, batch_id, quantity, unit, reason, source, source_ref, quarantined_by, quarantined_at, status) VALUES
    ('UINV-QA-001', prop_id, 'QUA-2026-0001', 'UINV-IT-002', 'UINV-ST-FOOD', 'UINV-BT-002', 5, 'kg', 'Packaging damaged on arrival', 'Receiving', 'GRN-2026-0003', 'John Storekeeper', '2026-08-21 10:00:00+00', 'Held')
  ON CONFLICT (id) DO NOTHING;

  -- Serials (high-value engineering items)
  INSERT INTO public.uinv_serials (id, property_id, item_id, store_id, location_id, serial_number, status, condition, acquired_at) VALUES
    ('UINV-SR-001', prop_id, 'UINV-IT-006', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', 'LED-9W-000001', 'In Stock', 'New', '2026-08-03'),
    ('UINV-SR-002', prop_id, 'UINV-IT-006', 'UINV-ST-ENG', 'UINV-LOC-ENG-1', 'LED-9W-000002', 'In Stock', 'New', '2026-08-03')
  ON CONFLICT (id) DO NOTHING;

  -- Temperature logs (cold store reading with an exception)
  INSERT INTO public.uinv_temperature_logs (id, property_id, store_id, location_id, required_min, required_max, actual_temp, unit, reading_time, recorded_by, status, corrective_action) VALUES
    ('UINV-TL-001', prop_id, 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 0, 5, 3.5, 'C', '2026-08-30 08:00:00+00', 'John Storekeeper', 'OK', NULL),
    ('UINV-TL-002', prop_id, 'UINV-ST-FOOD', 'UINV-LOC-FOOD-COLD', 0, 5, 7.0, 'C', '2026-08-30 14:00:00+00', 'Chef Marco', 'Exception', 'Adjusted thermostat; recheck in 1hr')
  ON CONFLICT (id) DO NOTHING;

  -- Chemical metadata for the cleaning chemical item
  INSERT INTO public.uinv_chemicals (id, property_id, item_id, classification, storage_requirement, sds_reference, authorized_handlers, hazard_level) VALUES
    ('UINV-CH-001', prop_id, 'UINV-IT-005', 'Corrosive', 'Cool, dry, ventilated area', 'SDS-CLEANMAX-2026', ARRAY['Alice Johnson','Tom Bradley'], 'High')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 10. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_putaway_tasks','uinv_picking_tasks','uinv_returns','uinv_quarantine','uinv_serials','uinv_lots','uinv_chemicals'];
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
