-- ============================================================
-- Finance — Approval Workflow
-- (Migration 404)
-- ============================================================
-- Brings /erp/finance/approval fully online.
-- Creates:
--   • fin_approval_requests   — multi-level authorization requests
--   • fin_approval_levels     — approval level configuration
--   • fin_delegation_rules    — temporary delegation rules
-- All tables are RLS-enabled and seeded with demo rows.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_approval_requests
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_approval_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  request_number text,
  type text NOT NULL DEFAULT 'journal' CHECK (type IN (
    'journal','vendor_invoice','payment','budget','expense','asset'
  )),
  title text NOT NULL,
  description text,
  amount numeric(15,2) NOT NULL DEFAULT 0,
  requested_by text,
  requested_by_name text,
  current_level integer NOT NULL DEFAULT 0,
  total_levels integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','approved','rejected','cancelled'
  )),
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_ar_property ON public.fin_approval_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_ar_status ON public.fin_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_fin_ar_type ON public.fin_approval_requests(type);
CREATE INDEX IF NOT EXISTS idx_fin_ar_created_at ON public.fin_approval_requests(created_at DESC);

ALTER TABLE public.fin_approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_approval_requests" ON public.fin_approval_requests;
CREATE POLICY "authenticated can CRUD fin_approval_requests" ON public.fin_approval_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_approval_requests" ON public.fin_approval_requests;
CREATE POLICY "service_role all fin_approval_requests" ON public.fin_approval_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_approval_requests TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_approval_levels
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_approval_levels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  requires_unanimous boolean NOT NULL DEFAULT false,
  approvers text[] NOT NULL DEFAULT '{}',
  spending_limit numeric(15,2),
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active','inactive'
  )),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_al_property ON public.fin_approval_levels(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_al_level ON public.fin_approval_levels(level);
CREATE INDEX IF NOT EXISTS idx_fin_al_status ON public.fin_approval_levels(status);

ALTER TABLE public.fin_approval_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_approval_levels" ON public.fin_approval_levels;
CREATE POLICY "authenticated can CRUD fin_approval_levels" ON public.fin_approval_levels
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_approval_levels" ON public.fin_approval_levels;
CREATE POLICY "service_role all fin_approval_levels" ON public.fin_approval_levels
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_approval_levels TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_delegation_rules
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_delegation_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  rule_name text NOT NULL,
  delegator text NOT NULL,
  delegatee text NOT NULL,
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN (
    'all','journal','vendor_invoice','payment','budget','expense','asset'
  )),
  spending_limit numeric(15,2),
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active','expired','revoked'
  )),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_dr_property ON public.fin_delegation_rules(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_dr_status ON public.fin_delegation_rules(status);
CREATE INDEX IF NOT EXISTS idx_fin_dr_delegator ON public.fin_delegation_rules(delegator);

ALTER TABLE public.fin_delegation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_delegation_rules" ON public.fin_delegation_rules;
CREATE POLICY "authenticated can CRUD fin_delegation_rules" ON public.fin_delegation_rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_delegation_rules" ON public.fin_delegation_rules;
CREATE POLICY "service_role all fin_delegation_rules" ON public.fin_delegation_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_delegation_rules TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. updated_at triggers
-- ════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_fin_ar_updated_at ON public.fin_approval_requests;
CREATE OR REPLACE FUNCTION public.set_fin_ar_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_ar_updated_at BEFORE UPDATE ON public.fin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_ar_updated_at();

DROP TRIGGER IF EXISTS trg_fin_al_updated_at ON public.fin_approval_levels;
CREATE OR REPLACE FUNCTION public.set_fin_al_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_al_updated_at BEFORE UPDATE ON public.fin_approval_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_al_updated_at();

DROP TRIGGER IF EXISTS trg_fin_dr_updated_at ON public.fin_delegation_rules;
CREATE OR REPLACE FUNCTION public.set_fin_dr_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_dr_updated_at BEFORE UPDATE ON public.fin_delegation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_dr_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 5. Seed demo data
-- ════════════════════════════════════════════════════════════════

-- Approval levels
INSERT INTO public.fin_approval_levels
  (property_id, name, level, requires_unanimous, approvers, spending_limit, description, status)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Department Manager', 1, false, ARRAY['manager@erp.com'], 50000, 'First-level approval by department manager', 'active'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Finance Controller', 2, false, ARRAY['controller@erp.com'], 250000, 'Second-level approval by finance controller', 'active'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'CFO / General Manager', 3, true, ARRAY['cfo@erp.com','gm@erp.com'], 1000000, 'Final-level approval by CFO and GM (unanimous)', 'active')
ON CONFLICT (id) DO NOTHING;

-- Approval requests
INSERT INTO public.fin_approval_requests
  (property_id, request_number, type, title, description, amount, requested_by, requested_by_name, current_level, total_levels, status, created_at)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-001', 'journal', 'Period-End Adjustment Journal', 'Adjusting entry for accrued expenses — June 2024', 75000, 'staff@erp.com', 'Finance Staff', 1, 3, 'pending', '2024-06-28 09:15:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-002', 'vendor_invoice', 'Supplier Invoice — ABC Supplies', 'Large supplier invoice for kitchen equipment', 185000, 'staff@erp.com', 'Finance Staff', 2, 3, 'pending', '2024-06-29 14:30:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-003', 'payment', 'Vendor Payment — Highland Logistics', 'Payment release for transport services', 42000, 'staff@erp.com', 'Finance Staff', 0, 1, 'pending', '2024-06-30 11:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-004', 'expense', 'Staff Reimbursement — Travel', 'Executive travel expense reimbursement', 12500, 'staff@erp.com', 'Finance Staff', 0, 2, 'pending', '2024-07-01 16:45:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-005', 'budget', 'Q3 Budget Revision — Marketing', 'Budget reallocation for marketing campaigns', 250000, 'staff@erp.com', 'Finance Staff', 2, 3, 'pending', '2024-07-02 10:20:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-006', 'asset', 'Fixed Asset Acquisition — Delivery Van', 'Purchase of new delivery vehicle', 850000, 'staff@erp.com', 'Finance Staff', 1, 3, 'pending', '2024-07-03 13:10:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-007', 'journal', 'Reclassification Journal', 'Reclassify prepaid expense to operating expense', 32000, 'staff@erp.com', 'Finance Staff', 3, 3, 'approved', '2024-06-15 09:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-008', 'payment', 'Vendor Payment — Office Supplies', 'Monthly office supplies payment', 18500, 'staff@erp.com', 'Finance Staff', 1, 1, 'approved', '2024-06-18 14:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-009', 'expense', 'Staff Reimbursement — Training', 'Training course reimbursement', 8500, 'staff@erp.com', 'Finance Staff', 1, 2, 'rejected', '2024-06-20 11:30:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AR-2024-010', 'vendor_invoice', 'Supplier Invoice — Tech Solutions', 'IT infrastructure invoice', 95000, 'staff@erp.com', 'Finance Staff', 2, 3, 'approved', '2024-06-22 15:45:00+03')
ON CONFLICT (id) DO NOTHING;

-- Update approved/rejected rows with timestamps
UPDATE public.fin_approval_requests SET approved_by='cfo@erp.com', approved_at='2024-06-15 10:30:00+03' WHERE request_number='AR-2024-007';
UPDATE public.fin_approval_requests SET approved_by='manager@erp.com', approved_at='2024-06-18 14:30:00+03' WHERE request_number='AR-2024-008';
UPDATE public.fin_approval_requests SET rejected_by='controller@erp.com', rejected_at='2024-06-20 12:00:00+03', rejection_reason='Exceeds training budget cap for the quarter' WHERE request_number='AR-2024-009';
UPDATE public.fin_approval_requests SET approved_by='cfo@erp.com', approved_at='2024-06-22 16:30:00+03' WHERE request_number='AR-2024-010';

-- Delegation rules
INSERT INTO public.fin_delegation_rules
  (property_id, rule_name, delegator, delegatee, scope, spending_limit, start_date, end_date, status, notes)
VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Controller Vacation Delegation', 'controller@erp.com', 'asst.controller@erp.com', 'all', 100000, '2024-07-15 00:00:00+03', '2024-07-30 23:59:59+03', 'active', 'Vacation coverage for finance controller'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'Manager Travel Delegation', 'manager@erp.com', 'asst.manager@erp.com', 'expense', 25000, '2024-08-01 00:00:00+03', '2024-08-10 23:59:59+03', 'active', 'Business travel delegation for expense approvals only'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'CFO Conference Delegation', 'cfo@erp.com', 'controller@erp.com', 'payment', 200000, '2024-09-05 00:00:00+03', '2024-09-12 23:59:59+03', 'active', 'Conference coverage — payments only up to 200K')
ON CONFLICT (id) DO NOTHING;
