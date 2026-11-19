-- ============================================================
-- Finance — Intercompany Accounting: invoices, due-to/from,
-- and elimination entries tables + seed data
-- (Migration 398)
-- ============================================================
-- Brings the /erp/finance/intercompany tab fully online:
--   • fin_intercompany_invoices   — intercompany invoices with approval flow
--   • fin_intercompany_balances   — due-to / due-from accounts with aging
--   • fin_intercompany_eliminations — elimination entries for consolidation
-- All tables are property-scoped, RLS-enabled, and seeded with demo
-- rows so the tab has data on a fresh DB.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_intercompany_invoices
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_intercompany_invoices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  invoice_number text,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  from_entity text NOT NULL,
  to_entity text NOT NULL,
  transaction_type text NOT NULL DEFAULT 'Service Charge' CHECK (transaction_type IN ('Service Charge','Staff Allocation','Management Fee','Cost Sharing','Loan','Expense Recharge','Revenue Transfer','Other')),
  description text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Posted','Rejected','Cancelled')),
  gl_ref text,
  posted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ic_inv_property ON public.fin_intercompany_invoices(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ic_inv_status ON public.fin_intercompany_invoices(status);
CREATE INDEX IF NOT EXISTS idx_fin_ic_inv_date ON public.fin_intercompany_invoices(invoice_date);

ALTER TABLE public.fin_intercompany_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_intercompany_invoices" ON public.fin_intercompany_invoices;
CREATE POLICY "authenticated can CRUD fin_intercompany_invoices" ON public.fin_intercompany_invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_intercompany_invoices" ON public.fin_intercompany_invoices;
CREATE POLICY "service_role all fin_intercompany_invoices" ON public.fin_intercompany_invoices
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_intercompany_invoices TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_intercompany_balances (Due To / Due From)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_intercompany_balances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  entity text NOT NULL,
  balance_type text NOT NULL DEFAULT 'Due To' CHECK (balance_type IN ('Due To','Due From')),
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  aging_bucket text NOT NULL DEFAULT '0-30' CHECK (aging_bucket IN ('0-30','31-60','61-90','90+')),
  reference_invoice text,
  last_activity date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ic_bal_property ON public.fin_intercompany_balances(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ic_bal_type ON public.fin_intercompany_balances(balance_type);

ALTER TABLE public.fin_intercompany_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_intercompany_balances" ON public.fin_intercompany_balances;
CREATE POLICY "authenticated can CRUD fin_intercompany_balances" ON public.fin_intercompany_balances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_intercompany_balances" ON public.fin_intercompany_balances;
CREATE POLICY "service_role all fin_intercompany_balances" ON public.fin_intercompany_balances
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_intercompany_balances TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_intercompany_eliminations
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_intercompany_eliminations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  entry_number text,
  period text NOT NULL,
  account text NOT NULL DEFAULT 'Intercompany Revenue',
  entity1 text NOT NULL,
  entity2 text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  description text,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Posted','Reversed')),
  posted_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_ic_elim_property ON public.fin_intercompany_eliminations(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ic_elim_status ON public.fin_intercompany_eliminations(status);
CREATE INDEX IF NOT EXISTS idx_fin_ic_elim_period ON public.fin_intercompany_eliminations(period);

ALTER TABLE public.fin_intercompany_eliminations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_intercompany_eliminations" ON public.fin_intercompany_eliminations;
CREATE POLICY "authenticated can CRUD fin_intercompany_eliminations" ON public.fin_intercompany_eliminations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_intercompany_eliminations" ON public.fin_intercompany_eliminations;
CREATE POLICY "service_role all fin_intercompany_eliminations" ON public.fin_intercompany_eliminations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_intercompany_eliminations TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. Seed data
-- ════════════════════════════════════════════════════════════════

-- fin_intercompany_invoices seed
INSERT INTO public.fin_intercompany_invoices (property_id, invoice_number, invoice_date, from_entity, to_entity, transaction_type, description, amount, status, gl_ref) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-001', '2026-09-01', 'Gheralta Main Property', 'Gheralta Airport Branch', 'Service Charge', 'Monthly shared services — IT, reservations, loyalty', 15000, 'Posted', 'GL-2026-0145'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-002', '2026-08-25', 'Gheralta Airport Branch', 'Gheralta Main Property', 'Staff Allocation', 'Housekeeping staff seconded for peak season', 8500, 'Pending', null),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-003', '2026-08-20', 'Gheralta Main Property', 'Corporate Office', 'Management Fee', 'Q3 management fee — brand & operations', 25000, 'Approved', null),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-004', '2026-08-15', 'Gheralta Airport Branch', 'Gheralta Main Property', 'Expense Recharge', 'Shared marketing campaign — summer promotion', 12000, 'Posted', 'GL-2026-0128'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-005', '2026-08-10', 'Corporate Office', 'Gheralta Main Property', 'Cost Sharing', 'Group insurance premium allocation', 18000, 'Approved', null),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-006', '2026-08-05', 'Gheralta Main Property', 'Gheralta Airport Branch', 'Revenue Transfer', 'Centralized booking revenue split — July', 22000, 'Posted', 'GL-2026-0102'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-007', '2026-07-28', 'Gheralta Airport Branch', 'Corporate Office', 'Loan', 'Inter-entity short-term loan — equipment purchase', 35000, 'Pending', null),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'IC-2026-008', '2026-07-20', 'Gheralta Main Property', 'Gheralta Airport Branch', 'Staff Allocation', 'F&B chef secondment — banquet event', 6500, 'Approved', null)
ON CONFLICT DO NOTHING;

-- fin_intercompany_balances seed
INSERT INTO public.fin_intercompany_balances (property_id, entity, balance_type, amount, aging_bucket, reference_invoice, last_activity) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Gheralta Airport Branch', 'Due To', 15000, '0-30', 'IC-2026-001', '2026-09-01'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Corporate Office', 'Due From', 25000, '0-30', 'IC-2026-003', '2026-08-20'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Gheralta Airport Branch', 'Due From', 12000, '0-30', 'IC-2026-004', '2026-08-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Corporate Office', 'Due To', 18000, '31-60', 'IC-2026-005', '2026-08-10'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Gheralta Airport Branch', 'Due To', 22000, '31-60', 'IC-2026-006', '2026-08-05'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Corporate Office', 'Due From', 35000, '61-90', 'IC-2026-007', '2026-07-28'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Gheralta Airport Branch', 'Due From', 6500, '61-90', 'IC-2026-008', '2026-07-20')
ON CONFLICT DO NOTHING;

-- fin_intercompany_eliminations seed
INSERT INTO public.fin_intercompany_eliminations (property_id, entry_number, period, account, entity1, entity2, amount, description, status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'EL-2026-001', '2026-Q3', 'Intercompany Revenue', 'Gheralta Main Property', 'Gheralta Airport Branch', 15000, 'Eliminate intercompany service charge revenue', 'Posted'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'EL-2026-002', '2026-Q3', 'Intercompany Expenses', 'Gheralta Airport Branch', 'Gheralta Main Property', 8500, 'Eliminate staff allocation expense', 'Posted'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'EL-2026-003', '2026-Q3', 'Management Fee', 'Gheralta Main Property', 'Corporate Office', 25000, 'Eliminate management fee — pending approval', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'EL-2026-004', '2026-Q3', 'Intercompany Revenue', 'Gheralta Airport Branch', 'Gheralta Main Property', 12000, 'Eliminate expense recharge revenue', 'Posted'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'EL-2026-005', '2026-Q3', 'Cost Sharing', 'Corporate Office', 'Gheralta Main Property', 18000, 'Eliminate cost sharing allocation', 'Pending'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'EL-2026-006', '2026-Q2', 'Revenue Transfer', 'Gheralta Main Property', 'Gheralta Airport Branch', 22000, 'Eliminate centralized booking revenue split', 'Posted')
ON CONFLICT DO NOTHING;
