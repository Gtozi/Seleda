-- ============================================================
-- Unified Inventory & Stores Portal — Governance & Audit (Migration 367)
-- ============================================================
-- Implements the cross-cutting governance tables per
-- docs/unified_inventory_stores_portal_expanded.md §71–§72, §76.
--
-- Tables:
--   uinv_inventory_periods — Inventory periods (open/close/freeze)
--   uinv_audit_logs        — Physical-resource audit trail
--   uinv_approval_requests — Configurable approval requests (SoD)
--
-- Also adds the v_uinv_expiry_alerts view for the Expiry module.
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- 1. uinv_inventory_periods — Inventory periods
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_inventory_periods (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  period_name text NOT NULL,
  period_type text NOT NULL DEFAULT 'Monthly' CHECK (period_type IN ('Daily','Weekly','Monthly','Quarterly','Yearly')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Frozen','Closed')),
  frozen_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  finance_handoff_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, period_name)
);
CREATE INDEX IF NOT EXISTS idx_uinv_periods_property ON public.uinv_inventory_periods(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_periods_status ON public.uinv_inventory_periods(status);
ALTER TABLE public.uinv_inventory_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_inventory_periods" ON public.uinv_inventory_periods FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_inventory_periods" ON public.uinv_inventory_periods FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_inventory_periods TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. uinv_audit_logs — Physical-resource audit trail
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_audit_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  department text,
  user_id text,
  user_name text,
  transaction_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  item_or_asset text,
  quantity numeric(12,3),
  value numeric(14,2),
  location text,
  batch_serial text,
  reason text,
  approval_ref text,
  previous_state jsonb,
  new_state jsonb,
  related_document text,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_audit_property ON public.uinv_audit_logs(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_audit_entity ON public.uinv_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_uinv_audit_user ON public.uinv_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_uinv_audit_time ON public.uinv_audit_logs(timestamp);
ALTER TABLE public.uinv_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read uinv_audit_logs" ON public.uinv_audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert uinv_audit_logs" ON public.uinv_audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "service_role all uinv_audit_logs" ON public.uinv_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON public.uinv_audit_logs TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. uinv_approval_requests — Configurable approval requests (SoD)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_approval_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  request_number text NOT NULL,
  approval_type text NOT NULL CHECK (approval_type IN (
    'High-Value Stock Adjustment','High-Value Waste','Asset Transfer',
    'Inter-Property Transfer','Asset Disposal','Missing Asset',
    'High-Value Issue','Count Variance','Quarantine Release','Other'
  )),
  entity_type text NOT NULL,
  entity_id text,
  requester text NOT NULL,
  requester_department text,
  value numeric(14,2),
  quantity numeric(12,3),
  reason text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  approver text,
  approver_role text,
  approved_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_appr_property ON public.uinv_approval_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_appr_status ON public.uinv_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_uinv_appr_type ON public.uinv_approval_requests(approval_type);
ALTER TABLE public.uinv_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_approval_requests" ON public.uinv_approval_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_approval_requests" ON public.uinv_approval_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_approval_requests TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. v_uinv_expiry_alerts — Expiry alert view (batches + lots)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_uinv_expiry_alerts AS
SELECT
  b.id AS batch_id,
  'batch' AS source,
  b.item_id,
  i.item_name,
  i.property_id,
  b.store_id,
  b.batch_number,
  b.expiry_date,
  b.quantity,
  b.unit_cost,
  b.status,
  CASE
    WHEN b.expiry_date < CURRENT_DATE THEN 'Expired'
    WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN '7 Days'
    WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '14 days' THEN '14 Days'
    WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN '30 Days'
    WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN '60 Days'
    WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN '90 Days'
    ELSE 'OK'
  END AS alert_bucket
FROM public.uinv_batches b
JOIN public.uinv_items i ON i.id = b.item_id
WHERE b.expiry_date IS NOT NULL
UNION ALL
SELECT
  l.id AS batch_id,
  'lot' AS source,
  l.item_id,
  i.item_name,
  l.property_id,
  l.store_id,
  l.lot_number AS batch_number,
  l.expiry_date,
  l.quantity,
  l.unit_cost,
  l.status,
  CASE
    WHEN l.expiry_date < CURRENT_DATE THEN 'Expired'
    WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN '7 Days'
    WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '14 days' THEN '14 Days'
    WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN '30 Days'
    WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN '60 Days'
    WHEN l.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN '90 Days'
    ELSE 'OK'
  END AS alert_bucket
FROM public.uinv_lots l
JOIN public.uinv_items i ON i.id = l.item_id
WHERE l.expiry_date IS NOT NULL;
ALTER VIEW public.v_uinv_expiry_alerts OWNER TO postgres;
GRANT SELECT ON public.v_uinv_expiry_alerts TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. Seed data — demo property
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Current monthly period (open)
  INSERT INTO public.uinv_inventory_periods (id, property_id, period_name, period_type, start_date, end_date, status) VALUES
    ('UINV-IP-001', prop_id, '2026-08', 'Monthly', '2026-08-01', '2026-08-31', 'Open')
  ON CONFLICT (id) DO NOTHING;

  -- A sample audit log entry
  INSERT INTO public.uinv_audit_logs (id, property_id, department, user_name, transaction_type, entity_type, entity_id, item_or_asset, quantity, value, location, reason, timestamp) VALUES
    ('UINV-AL-001', prop_id, 'Inventory', 'John Storekeeper', 'Goods Receipt', 'goods_receipt', 'UINV-GRN-001', 'Fresh Organic Tomatoes', 120, 1500.00, 'Cold Storage 1', 'Receipt from Global Foods Ltd', '2026-08-01 09:30:00+00')
  ON CONFLICT (id) DO NOTHING;

  -- A pending approval for the high-value waste
  INSERT INTO public.uinv_approval_requests (id, property_id, request_number, approval_type, entity_type, entity_id, requester, requester_department, value, quantity, reason, status) VALUES
    ('UINV-AR-001', prop_id, 'APR-2026-0001', 'High-Value Waste', 'waste', 'UINV-WA-001', 'Chef Marco', 'Food & Beverage', 37.50, 3, 'Over-ripe produce spoilage', 'Pending')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 6. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_inventory_periods','uinv_approval_requests'];
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
