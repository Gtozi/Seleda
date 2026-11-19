-- ============================================================
-- Finance — Period Close Checklist
-- (Migration 400)
-- ============================================================
-- Brings the /erp/finance/financial_close checklist tab fully online:
--   • fin_period_close_checklist — per-period close tasks with
--     category, assigned role, completion status, and notes.
-- The accounting_periods table already exists (property-scoped).
-- All tables are RLS-enabled and seeded with demo rows so the tab
-- has data on a fresh DB.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_period_close_checklist
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_period_close_checklist (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  period_id text REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'General Ledger' CHECK (category IN (
    'Revenue','Accounts Receivable','Accounts Payable','Bank Reconciliation',
    'General Ledger','Tax Compliance','Financial Reports','Payroll','Inventory'
  )),
  task text NOT NULL,
  assigned_to text,
  completed boolean NOT NULL DEFAULT false,
  completed_by text,
  completed_at timestamptz,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_pcc_property ON public.fin_period_close_checklist(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_pcc_period ON public.fin_period_close_checklist(period_id);
CREATE INDEX IF NOT EXISTS idx_fin_pcc_category ON public.fin_period_close_checklist(category);
CREATE INDEX IF NOT EXISTS idx_fin_pcc_completed ON public.fin_period_close_checklist(completed);

ALTER TABLE public.fin_period_close_checklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_period_close_checklist" ON public.fin_period_close_checklist;
CREATE POLICY "authenticated can CRUD fin_period_close_checklist" ON public.fin_period_close_checklist
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_period_close_checklist" ON public.fin_period_close_checklist;
CREATE POLICY "service_role all fin_period_close_checklist" ON public.fin_period_close_checklist
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_period_close_checklist TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. Seed data — link to the most recent open period
-- ════════════════════════════════════════════════════════════════
-- Find the most recent open period for the demo property to link
-- checklist items to it. If none exists, link to the most recent period.
DO $$
DECLARE
  v_period_id text;
  v_property_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  SELECT id INTO v_period_id
  FROM public.accounting_periods
  WHERE property_id = v_property_id OR property_id IS NULL
  ORDER BY period_start DESC
  LIMIT 1;

  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id FROM public.accounting_periods ORDER BY period_start DESC LIMIT 1;
  END IF;

  IF v_period_id IS NOT NULL THEN
    INSERT INTO public.fin_period_close_checklist (property_id, period_id, category, task, assigned_to, completed, sort_order) VALUES
      (v_property_id, v_period_id, 'Revenue', 'Verify all room revenue posted', 'Front Desk', true, 1),
      (v_property_id, v_period_id, 'Revenue', 'Reconcile POS terminal batches', 'F&B Manager', true, 2),
      (v_property_id, v_period_id, 'Revenue', 'Review guest folio adjustments', 'Night Auditor', true, 3),
      (v_property_id, v_period_id, 'Accounts Receivable', 'Post all AR invoices', 'AR Specialist', true, 4),
      (v_property_id, v_period_id, 'Accounts Receivable', 'Review AR aging report', 'AR Specialist', true, 5),
      (v_property_id, v_period_id, 'Accounts Payable', 'Verify all bills entered', 'AP Clerk', true, 6),
      (v_property_id, v_period_id, 'Accounts Payable', 'Process vendor payments', 'AP Manager', false, 7),
      (v_property_id, v_period_id, 'Bank Reconciliation', 'Reconcile all bank accounts', 'Accountant', true, 8),
      (v_property_id, v_period_id, 'Bank Reconciliation', 'Verify cash on hand', 'Cashier', true, 9),
      (v_property_id, v_period_id, 'General Ledger', 'Review journal entries', 'Controller', true, 10),
      (v_property_id, v_period_id, 'General Ledger', 'Post depreciation', 'Accountant', false, 11),
      (v_property_id, v_period_id, 'Tax Compliance', 'Calculate VAT liability', 'Tax Specialist', true, 12),
      (v_property_id, v_period_id, 'Tax Compliance', 'Calculate withholding tax', 'Tax Specialist', true, 13),
      (v_property_id, v_period_id, 'Financial Reports', 'Generate trial balance', 'Controller', true, 14),
      (v_property_id, v_period_id, 'Financial Reports', 'Generate P&L statement', 'Controller', false, 15),
      (v_property_id, v_period_id, 'Financial Reports', 'Generate balance sheet', 'Controller', false, 16)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
