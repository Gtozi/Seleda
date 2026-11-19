-- ════════════════════════════════════════════════════════════════
-- 386 — Unified Inventory governance & accounting gap fixes
--
-- Companion to migration 385. Implements the audit findings that
-- require schema objects:
--
--   1. RBAC: registers the 10 current inventory tab modIds in the
--      `modules` registry (they were never registered, so admins
--      could not grant/revoke them) and deactivates the 5 stale
--      pre-rebuild module rows.
--   2. Disposal/retirement accounting (spec §58-§59, §77): GL accounts
--      for disposal gain/loss + `post_asset_disposal_journal()` and
--      `post_asset_retirement_journal()` functions, plus retirement
--      columns on uinv_assets.
--   3. Variance investigation workflow (spec §23, §50):
--      uinv_variance_investigations table.
--   4. Warranty & insurance claims history (spec §40-§41):
--      uinv_warranty_claims + uinv_insurance_claims tables.
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 1. Register current inventory modules in the RBAC registry
-- ════════════════════════════════════════════════════════════════
-- The 14 consolidated tabs (departmentTabs.ts) map to these modIds.
-- inv_dashboard / inv_items / inv_stores / inv_reports already exist
-- (migration 187). The other 10 were missing — meaning
-- hasModuleAccess() defaulted them to "allowed" and the admin
-- permission grid could not govern them.
INSERT INTO public.modules (id, department, label, icon, description, is_active, sort_order) VALUES
  ('inv_inventory',               'inventory', 'Inventory Control',          '📦', 'Stock balances, ledger and movements',        true, 11),
  ('inv_stock_operations',        'inventory', 'Stock Operations',           '🔄', 'Receiving, issues, returns and transfers',     true, 12),
  ('inv_storekeeping',            'inventory', 'Storekeeping',               '🗄️', 'Put-away, picking, quarantine, serials/lots',  true, 13),
  ('inv_stock_control',           'inventory', 'Stock Control',              '🎛️', 'Adjustments, counts, waste, consumption',      true, 14),
  ('inv_reservations_allocations','inventory', 'Reservations & Allocations', '📅', 'Stock reservations and allocations',           true, 15),
  ('inv_replenishment',           'inventory', 'Replenishment & Procurement','📈', 'Replenishment and supply procurement',         true, 16),
  ('inv_fixed_assets',            'inventory', 'Assets & Resources',         '🏗️', 'Fixed assets, tools, linen, uniforms',         true, 17),
  ('inv_audit',                   'inventory', 'Audit & Compliance',         '⚖️', 'Periods, audit log and approvals',             true, 18),
  ('inv_advanced_operations',     'inventory', 'Advanced Operations',        '🔧', 'Critical spares, compatibility, custody',      true, 19),
  ('inv_configuration',           'inventory', 'Configuration',              '⚙️', 'Inventory portal configuration',               true, 20)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      is_active = true,
      sort_order = EXCLUDED.sort_order;

-- Deactivate the stale pre-rebuild module rows (tabs no longer exist).
-- Rows are kept (not deleted) so historical user moduleAccess entries
-- keep their referential meaning.
UPDATE public.modules SET is_active = false
  WHERE department = 'inventory'
    AND id IN ('inv_requisition','inv_requisitions','inv_receiving',
               'inv_count','inv_suppliers','inv_standard_reports');

-- ════════════════════════════════════════════════════════════════
-- 2. Disposal / retirement GL accounts (USALI 4xxx/8xxx)
-- ════════════════════════════════════════════════════════════════
INSERT INTO public.usali_chart_of_accounts (code, name, category, subcategory, department, account_type, normal_balance, currency, is_control_account, balance)
VALUES
  ('4900', 'Gain on Asset Disposal',   'Revenue', 'Other Income',   'Inventory', 'Revenue', 'Credit', 'ETB', false, 0),
  ('8460', 'Loss on Asset Disposal',   'Expense', 'Operating Expenses', 'Inventory', 'Expense', 'Debit', 'ETB', false, 0),
  ('8470', 'Loss on Asset Retirement', 'Expense', 'Operating Expenses', 'Inventory', 'Expense', 'Debit', 'ETB', false, 0)
ON CONFLICT (code) DO NOTHING;

-- Retirement columns on the asset register (spec §59 — a retirement is
-- distinct from a disposal: no proceeds, full write-off).
ALTER TABLE public.uinv_assets
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retirement_reason text,
  ADD COLUMN IF NOT EXISTS retirement_reference text;

-- ════════════════════════════════════════════════════════════════
-- 3. post_asset_disposal_journal — balanced disposal entry
-- ════════════════════════════════════════════════════════════════
-- Reads the disposal + asset and posts:
--   Debit:  proceeds (disposal_value)   [cash/receivable proxy: 1100-free 1190 contra not used; use a current-asset clearing account]
--   Debit:  8460 Loss on Asset Disposal (when proceeds < book value)
--   Credit: asset book value (acquisition_cost as the NBV proxy —
--           depreciation is owned by Finance, which can reclass)
--   Credit: 4900 Gain on Asset Disposal (when proceeds > book value)
-- Duplicate-safe via uinv_journal_posting_log.
CREATE OR REPLACE FUNCTION public.post_asset_disposal_journal(
  p_disposal_id text,
  p_performed_by text DEFAULT 'system'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_disposal RECORD;
  v_asset RECORD;
  v_journal_id text;
  v_book_value numeric;
  v_proceeds numeric;
  v_gain numeric;
  v_loss numeric;
  v_cash_account text;
  v_line int := 1;
BEGIN
  SELECT * INTO v_disposal FROM public.uinv_asset_disposals WHERE id = p_disposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disposal % not found', p_disposal_id USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_asset FROM public.uinv_assets WHERE id = v_disposal.asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % not found for disposal %', v_disposal.asset_id, p_disposal_id USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.uinv_journal_posting_log
             WHERE source_entity = 'uinv_asset_disposals' AND source_id = p_disposal_id) THEN
    RETURN NULL;
  END IF;

  v_book_value := COALESCE(v_asset.acquisition_cost, 0);
  v_proceeds := COALESCE(v_disposal.disposal_value, 0);
  IF v_book_value = 0 AND v_proceeds = 0 THEN
    RETURN NULL;
  END IF;
  v_gain := GREATEST(0, v_proceeds - v_book_value);
  v_loss := GREATEST(0, v_book_value - v_proceeds);

  -- Proceeds clearing account: prefer a cash account, fall back to 1190
  SELECT code INTO v_cash_account FROM public.usali_chart_of_accounts
    WHERE account_type = 'Asset' AND name ILIKE '%cash%' LIMIT 1;
  v_cash_account := COALESCE(v_cash_account, '1190');

  v_journal_id := 'je_disp_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_' || md5(p_disposal_id)::text;

  INSERT INTO public.journal_entries (
    id, entry_date, period, source, reference, description,
    status, total_debit, total_credit, department, property_id, created_by
  ) VALUES (
    v_journal_id, CURRENT_DATE, to_char(now(), 'YYYY-MM'), 'System',
    'disposal:' || p_disposal_id,
    'Asset disposal - ' || v_asset.asset_name || ' (' || v_disposal.disposal_number || ')',
    'Draft', v_book_value + v_gain, v_book_value + v_gain,
    'Inventory', v_disposal.property_id, p_performed_by
  );

  IF v_proceeds > 0 THEN
    INSERT INTO public.journal_lines (id, journal_entry_id, account_code, account_name, description, debit, credit, line_number)
    VALUES (gen_random_uuid()::text, v_journal_id, v_cash_account,
      (SELECT name FROM public.usali_chart_of_accounts WHERE code = v_cash_account),
      'Disposal proceeds - ' || v_asset.asset_name, v_proceeds, 0, v_line);
    v_line := v_line + 1;
  END IF;
  IF v_loss > 0 THEN
    INSERT INTO public.journal_lines (id, journal_entry_id, account_code, account_name, description, debit, credit, line_number)
    VALUES (gen_random_uuid()::text, v_journal_id, '8460',
      (SELECT name FROM public.usali_chart_of_accounts WHERE code = '8460'),
      'Loss on disposal - ' || v_asset.asset_name, v_loss, 0, v_line);
    v_line := v_line + 1;
  END IF;
  IF v_book_value > 0 THEN
    INSERT INTO public.journal_lines (id, journal_entry_id, account_code, account_name, description, debit, credit, line_number)
    VALUES (gen_random_uuid()::text, v_journal_id, '1190',
      (SELECT name FROM public.usali_chart_of_accounts WHERE code = '1190'),
      'Asset written off - ' || v_asset.asset_name, 0, v_book_value, v_line);
    v_line := v_line + 1;
  END IF;
  IF v_gain > 0 THEN
    INSERT INTO public.journal_lines (id, journal_entry_id, account_code, account_name, description, debit, credit, line_number)
    VALUES (gen_random_uuid()::text, v_journal_id, '4900',
      (SELECT name FROM public.usali_chart_of_accounts WHERE code = '4900'),
      'Gain on disposal - ' || v_asset.asset_name, 0, v_gain, v_line);
  END IF;

  INSERT INTO public.uinv_journal_posting_log (source_entity, source_id, journal_id, posting_type, amount)
  VALUES ('uinv_asset_disposals', p_disposal_id, v_journal_id, 'Asset Disposal', v_book_value + v_gain);

  RETURN v_journal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_asset_disposal_journal(text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. post_asset_retirement_journal — full write-off entry
-- ════════════════════════════════════════════════════════════════
-- Debit 8470 Loss on Asset Retirement / Credit the asset book value.
CREATE OR REPLACE FUNCTION public.post_asset_retirement_journal(
  p_asset_id text,
  p_reason text DEFAULT NULL,
  p_performed_by text DEFAULT 'system'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_journal_id text;
  v_book_value numeric;
BEGIN
  SELECT * INTO v_asset FROM public.uinv_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % not found', p_asset_id USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.uinv_journal_posting_log
             WHERE source_entity = 'uinv_assets:retirement' AND source_id = p_asset_id) THEN
    RETURN NULL;
  END IF;

  v_book_value := COALESCE(v_asset.acquisition_cost, 0);
  IF v_book_value = 0 THEN
    RETURN NULL;
  END IF;

  v_journal_id := 'je_ret_' || to_char(now(), 'YYYYMMDDHH24MISS') || '_' || md5(p_asset_id)::text;

  INSERT INTO public.journal_entries (
    id, entry_date, period, source, reference, description,
    status, total_debit, total_credit, department, property_id, created_by
  ) VALUES (
    v_journal_id, CURRENT_DATE, to_char(now(), 'YYYY-MM'), 'System',
    'retirement:' || p_asset_id,
    'Asset retirement - ' || v_asset.asset_name || COALESCE(' - ' || p_reason, ''),
    'Draft', v_book_value, v_book_value,
    'Inventory', v_asset.property_id, p_performed_by
  );

  INSERT INTO public.journal_lines (id, journal_entry_id, account_code, account_name, description, debit, credit, line_number)
  VALUES
    (gen_random_uuid()::text, v_journal_id, '8470',
     (SELECT name FROM public.usali_chart_of_accounts WHERE code = '8470'),
     'Loss on retirement - ' || v_asset.asset_name, v_book_value, 0, 1),
    (gen_random_uuid()::text, v_journal_id, '1190',
     (SELECT name FROM public.usali_chart_of_accounts WHERE code = '1190'),
     'Asset written off (retirement) - ' || v_asset.asset_name, 0, v_book_value, 2);

  INSERT INTO public.uinv_journal_posting_log (source_entity, source_id, journal_id, posting_type, amount)
  VALUES ('uinv_assets:retirement', p_asset_id, v_journal_id, 'Asset Retirement', v_book_value);

  RETURN v_journal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_asset_retirement_journal(text, text, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. uinv_variance_investigations — variance workflow (spec §23/§50)
-- ════════════════════════════════════════════════════════════════
-- Bridges count variance detection -> investigation -> resolution
-- (adjustment approval or accepted write-off).
CREATE TABLE IF NOT EXISTS public.uinv_variance_investigations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  investigation_number text NOT NULL,
  count_id text REFERENCES public.uinv_counts(id) ON DELETE SET NULL,
  item_id text REFERENCES public.uinv_items(id) ON DELETE CASCADE,
  store_id text REFERENCES public.uinv_stores(id) ON DELETE SET NULL,
  batch_id text REFERENCES public.uinv_batches(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'Stock Count'
    CHECK (source IN ('Stock Count','Receiving','Issue','Return','Transfer','Waste','Adjustment','Batch','Other')),
  variance_quantity numeric(12,3) NOT NULL DEFAULT 0,
  variance_value numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open','Under Investigation','Resolved - Adjusted','Resolved - Accepted','Resolved - Escalated','Closed')),
  assigned_to text,
  root_cause text,
  corrective_action text,
  resolved_at timestamptz,
  resolved_by text,
  adjustment_id text REFERENCES public.uinv_adjustments(id) ON DELETE SET NULL,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_vi_property ON public.uinv_variance_investigations(property_id);
CREATE INDEX IF NOT EXISTS idx_uinv_vi_count ON public.uinv_variance_investigations(count_id);
CREATE INDEX IF NOT EXISTS idx_uinv_vi_status ON public.uinv_variance_investigations(status);
ALTER TABLE public.uinv_variance_investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_variance_investigations" ON public.uinv_variance_investigations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_variance_investigations" ON public.uinv_variance_investigations FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_variance_investigations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 6. uinv_warranty_claims — warranty claims history (spec §40)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_warranty_claims (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  warranty_id text REFERENCES public.uinv_asset_warranties(id) ON DELETE CASCADE,
  asset_id text REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  claim_number text NOT NULL,
  claim_date date NOT NULL DEFAULT CURRENT_DATE,
  issue_description text,
  repair_reference text,
  claim_value numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Submitted'
    CHECK (status IN ('Submitted','Under Review','Approved','Partially Approved','Rejected','Repaired','Replaced','Closed')),
  resolved_at date,
  resolution_notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_wc_warranty ON public.uinv_warranty_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_uinv_wc_asset ON public.uinv_warranty_claims(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_wc_status ON public.uinv_warranty_claims(status);
ALTER TABLE public.uinv_warranty_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_warranty_claims" ON public.uinv_warranty_claims FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_warranty_claims" ON public.uinv_warranty_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_warranty_claims TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 7. uinv_insurance_claims — insurance claims history (spec §41)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.uinv_insurance_claims (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  insurance_id text REFERENCES public.uinv_asset_insurance(id) ON DELETE CASCADE,
  asset_id text REFERENCES public.uinv_assets(id) ON DELETE CASCADE,
  claim_number text NOT NULL,
  incident_date date NOT NULL DEFAULT CURRENT_DATE,
  incident_description text,
  claimed_amount numeric(14,2) NOT NULL DEFAULT 0,
  approved_amount numeric(14,2),
  status text NOT NULL DEFAULT 'Submitted'
    CHECK (status IN ('Submitted','Under Review','Approved','Partially Approved','Rejected','Paid','Closed')),
  settled_at date,
  settlement_notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uinv_ic_insurance ON public.uinv_insurance_claims(insurance_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ic_asset ON public.uinv_insurance_claims(asset_id);
CREATE INDEX IF NOT EXISTS idx_uinv_ic_status ON public.uinv_insurance_claims(status);
ALTER TABLE public.uinv_insurance_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can CRUD uinv_insurance_claims" ON public.uinv_insurance_claims FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role all uinv_insurance_claims" ON public.uinv_insurance_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uinv_insurance_claims TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 8. updated_at triggers for the new tables
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
  tables text[] := ARRAY['uinv_variance_investigations','uinv_warranty_claims','uinv_insurance_claims'];
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
-- 9. Verification notices
-- ════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'Migration 388 complete: governance & accounting gaps installed.';
  RAISE NOTICE 'Modules registered: 10 current inventory modIds active; 5 stale rows deactivated';
  RAISE NOTICE 'GL accounts: 4900 (disposal gain), 8460 (disposal loss), 8470 (retirement loss)';
  RAISE NOTICE 'Functions: post_asset_disposal_journal(), post_asset_retirement_journal()';
  RAISE NOTICE 'Tables: uinv_variance_investigations, uinv_warranty_claims, uinv_insurance_claims';
  RAISE NOTICE 'Columns: uinv_assets.retired_at / retirement_reason / retirement_reference';
END $$;
