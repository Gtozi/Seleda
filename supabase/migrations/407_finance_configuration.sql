-- ============================================================
-- Finance — Configuration (Migration 407)
-- ============================================================
-- Brings /erp/finance/config fully online.
-- Creates the missing configuration tables that back the
-- FinanceConfiguration.tsx UI:
--   • fin_fiscal_years        — fiscal year definitions
--   • fin_currencies          — currency + exchange rate setup
--   • fin_tax_jurisdictions   — tax authorities / jurisdictions
--   • fin_journal_types       — journal entry type catalog
--   • fin_posting_profiles    — module → debit/credit account mapping
-- Also seeds existing tables (fiscal_periods, tax_codes, posting_rules)
-- with demo data so the config screen has content on first load.
-- All tables are RLS-enabled (matching the existing finance pattern).
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property
DO $$
DECLARE
  v_property uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
-- ════════════════════════════════════════════════════════════════
-- 1. fin_fiscal_years
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_fiscal_years (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  is_current boolean NOT NULL DEFAULT false,
  closed_by text,
  closed_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_fy_property ON public.fin_fiscal_years(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_fy_status ON public.fin_fiscal_years(status);
CREATE INDEX IF NOT EXISTS idx_fin_fy_current ON public.fin_fiscal_years(is_current);
CREATE INDEX IF NOT EXISTS idx_fin_fy_start ON public.fin_fiscal_years(start_date DESC);

ALTER TABLE public.fin_fiscal_years ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_fiscal_years" ON public.fin_fiscal_years;
CREATE POLICY "authenticated can CRUD fin_fiscal_years" ON public.fin_fiscal_years
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_fiscal_years" ON public.fin_fiscal_years;
CREATE POLICY "service_role all fin_fiscal_years" ON public.fin_fiscal_years
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_fiscal_years TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_currencies
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_currencies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  is_base boolean NOT NULL DEFAULT false,
  exchange_rate numeric(18,6) NOT NULL DEFAULT 1.0,
  last_updated date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_cur_property ON public.fin_currencies(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_cur_code ON public.fin_currencies(code);
CREATE INDEX IF NOT EXISTS idx_fin_cur_base ON public.fin_currencies(is_base);

ALTER TABLE public.fin_currencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_currencies" ON public.fin_currencies;
CREATE POLICY "authenticated can CRUD fin_currencies" ON public.fin_currencies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_currencies" ON public.fin_currencies;
CREATE POLICY "service_role all fin_currencies" ON public.fin_currencies
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_currencies TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_tax_jurisdictions
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_tax_jurisdictions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  jurisdiction text NOT NULL,
  jurisdiction_type text NOT NULL DEFAULT 'Regional' CHECK (jurisdiction_type IN ('National','Regional','Local')),
  tax_authority text NOT NULL,
  filing_frequency text NOT NULL DEFAULT 'Monthly' CHECK (filing_frequency IN ('Monthly','Quarterly','Annual')),
  registration_number text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_tj_property ON public.fin_tax_jurisdictions(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_tj_status ON public.fin_tax_jurisdictions(status);

ALTER TABLE public.fin_tax_jurisdictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_tax_jurisdictions" ON public.fin_tax_jurisdictions;
CREATE POLICY "authenticated can CRUD fin_tax_jurisdictions" ON public.fin_tax_jurisdictions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_tax_jurisdictions" ON public.fin_tax_jurisdictions;
CREATE POLICY "service_role all fin_tax_jurisdictions" ON public.fin_tax_jurisdictions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_tax_jurisdictions TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. fin_journal_types
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_journal_types (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT 'bg-blue-50 text-blue-700',
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_jt_property ON public.fin_journal_types(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_jt_code ON public.fin_journal_types(code);
CREATE INDEX IF NOT EXISTS idx_fin_jt_status ON public.fin_journal_types(status);

ALTER TABLE public.fin_journal_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_journal_types" ON public.fin_journal_types;
CREATE POLICY "authenticated can CRUD fin_journal_types" ON public.fin_journal_types
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_journal_types" ON public.fin_journal_types;
CREATE POLICY "service_role all fin_journal_types" ON public.fin_journal_types
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_journal_types TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. fin_posting_profiles
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_posting_profiles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  name text NOT NULL,
  module text NOT NULL,
  debit_account_code text,
  debit_account_name text,
  credit_account_code text,
  credit_account_name text,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_pp_property ON public.fin_posting_profiles(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_pp_module ON public.fin_posting_profiles(module);
CREATE INDEX IF NOT EXISTS idx_fin_pp_status ON public.fin_posting_profiles(status);

ALTER TABLE public.fin_posting_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_posting_profiles" ON public.fin_posting_profiles;
CREATE POLICY "authenticated can CRUD fin_posting_profiles" ON public.fin_posting_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_posting_profiles" ON public.fin_posting_profiles;
CREATE POLICY "service_role all fin_posting_profiles" ON public.fin_posting_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_posting_profiles TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════════

-- Fiscal years
INSERT INTO public.fin_fiscal_years (property_id, name, start_date, end_date, status, is_current, notes)
SELECT v_property, 'FY 2024', '2024-01-01', '2024-12-31', 'open', true, 'Current fiscal year'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_fiscal_years WHERE property_id = v_property AND name = 'FY 2024');

INSERT INTO public.fin_fiscal_years (property_id, name, start_date, end_date, status, is_current, notes)
SELECT v_property, 'FY 2023', '2023-01-01', '2023-12-31', 'closed', false, 'Prior fiscal year — closed'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_fiscal_years WHERE property_id = v_property AND name = 'FY 2023');

INSERT INTO public.fin_fiscal_years (property_id, name, start_date, end_date, status, is_current, notes)
SELECT v_property, 'FY 2022', '2022-01-01', '2022-12-31', 'closed', false, 'Archived fiscal year'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_fiscal_years WHERE property_id = v_property AND name = 'FY 2022');

-- Fiscal periods (fiscal_periods table already exists, seed if empty)
INSERT INTO public.fiscal_periods (id, property_id, fiscal_year, period_number, period_name, start_date, end_date, status, is_locked)
SELECT 'fp_2024_q1', v_property, 2024, 1, 'Q1 2024', '2024-01-01', '2024-03-31', 'Closed', true
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = 'fp_2024_q1');
INSERT INTO public.fiscal_periods (id, property_id, fiscal_year, period_number, period_name, start_date, end_date, status, is_locked)
SELECT 'fp_2024_q2', v_property, 2024, 2, 'Q2 2024', '2024-04-01', '2024-06-30', 'Closed', true
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = 'fp_2024_q2');
INSERT INTO public.fiscal_periods (id, property_id, fiscal_year, period_number, period_name, start_date, end_date, status, is_locked)
SELECT 'fp_2024_q3', v_property, 2024, 3, 'Q3 2024', '2024-07-01', '2024-09-30', 'Open', false
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = 'fp_2024_q3');
INSERT INTO public.fiscal_periods (id, property_id, fiscal_year, period_number, period_name, start_date, end_date, status, is_locked)
SELECT 'fp_2024_q4', v_property, 2024, 4, 'Q4 2024', '2024-10-01', '2024-12-31', 'Open', false
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = 'fp_2024_q4');

-- Currencies
INSERT INTO public.fin_currencies (property_id, code, name, symbol, is_base, exchange_rate, last_updated, status)
SELECT v_property, 'ETB', 'Ethiopian Birr', 'Br', true, 1.0, CURRENT_DATE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_currencies WHERE property_id = v_property AND code = 'ETB');
INSERT INTO public.fin_currencies (property_id, code, name, symbol, is_base, exchange_rate, last_updated, status)
SELECT v_property, 'USD', 'US Dollar', '$', false, 57.50, CURRENT_DATE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_currencies WHERE property_id = v_property AND code = 'USD');
INSERT INTO public.fin_currencies (property_id, code, name, symbol, is_base, exchange_rate, last_updated, status)
SELECT v_property, 'EUR', 'Euro', '€', false, 62.30, CURRENT_DATE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_currencies WHERE property_id = v_property AND code = 'EUR');
INSERT INTO public.fin_currencies (property_id, code, name, symbol, is_base, exchange_rate, last_updated, status)
SELECT v_property, 'GBP', 'British Pound', '£', false, 73.10, CURRENT_DATE, 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_currencies WHERE property_id = v_property AND code = 'GBP');

-- Tax jurisdictions
INSERT INTO public.fin_tax_jurisdictions (property_id, jurisdiction, jurisdiction_type, tax_authority, filing_frequency, registration_number, status)
SELECT v_property, 'Federal', 'National', 'Ethiopian Revenue Authority', 'Monthly', 'ERA-12345', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_tax_jurisdictions WHERE property_id = v_property AND jurisdiction = 'Federal');
INSERT INTO public.fin_tax_jurisdictions (property_id, jurisdiction, jurisdiction_type, tax_authority, filing_frequency, registration_number, status)
SELECT v_property, 'Addis Ababa', 'Regional', 'Addis Ababa Revenue Authority', 'Monthly', 'AARA-67890', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_tax_jurisdictions WHERE property_id = v_property AND jurisdiction = 'Addis Ababa');
INSERT INTO public.fin_tax_jurisdictions (property_id, jurisdiction, jurisdiction_type, tax_authority, filing_frequency, registration_number, status)
SELECT v_property, 'Tigray', 'Regional', 'Tigray Revenue Authority', 'Quarterly', 'TRA-11223', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.fin_tax_jurisdictions WHERE property_id = v_property AND jurisdiction = 'Tigray');

-- Journal types
INSERT INTO public.fin_journal_types (property_id, code, name, description, color, is_system, status) VALUES
(v_property, 'JE', 'Standard Journal Entry', 'General purpose manual journal entry', 'bg-blue-50 text-blue-700', true, 'active'),
(v_property, 'REV', 'Reversing Entry', 'Auto-reverses in next period', 'bg-purple-50 text-purple-700', true, 'active'),
(v_property, 'ACC', 'Accrual Entry', 'Records expenses before invoice', 'bg-amber-50 text-amber-700', true, 'active'),
(v_property, 'DEF', 'Deferral Entry', 'Defers revenue to future periods', 'bg-emerald-50 text-emerald-700', true, 'active'),
(v_property, 'REVAL', 'Revaluation Entry', 'FX revaluation of foreign currency', 'bg-rose-50 text-rose-700', true, 'active'),
(v_property, 'DEP', 'Depreciation Entry', 'Auto-generated from Fixed Assets', 'bg-indigo-50 text-indigo-700', true, 'active'),
(v_property, 'ALLOC', 'Allocation Entry', 'Cost center allocations', 'bg-teal-50 text-teal-700', true, 'active'),
(v_property, 'IC', 'Intercompany Entry', 'Cross-entity transactions', 'bg-orange-50 text-orange-700', true, 'active'),
(v_property, 'CLOSE', 'Closing Entry', 'Period-end closing entries', 'bg-slate-100 text-slate-700', true, 'active')
ON CONFLICT DO NOTHING;

-- Posting profiles
INSERT INTO public.fin_posting_profiles (property_id, name, module, debit_account_code, debit_account_name, credit_account_code, credit_account_name, status) VALUES
(v_property, 'Room Revenue Posting', 'Front Office', '1100', 'Accounts Receivable', '4000', 'Room Revenue', 'active'),
(v_property, 'F&B Revenue Posting', 'F&B', '1100', 'Accounts Receivable', '4100', 'F&B Revenue', 'active'),
(v_property, 'Vendor Invoice Posting', 'AP', '5000', 'Expense', '2000', 'Accounts Payable', 'active'),
(v_property, 'Payment Posting', 'AR', '1000', 'Cash', '1100', 'Accounts Receivable', 'active'),
(v_property, 'Payroll Posting', 'HR', '5100', 'Salaries', '2100', 'Accrued Payroll', 'active'),
(v_property, 'Depreciation Posting', 'Fixed Assets', '5200', 'Depreciation', '1500', 'Accum. Dep.', 'active')
ON CONFLICT DO NOTHING;

END $$;

-- ════════════════════════════════════════════════════════════════
-- updated_at triggers (idempotent)
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fin_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_fin_fy_updated ON public.fin_fiscal_years;
CREATE TRIGGER trg_fin_fy_updated BEFORE UPDATE ON public.fin_fiscal_years
  FOR EACH ROW EXECUTE FUNCTION public.fin_set_updated_at();

DROP TRIGGER IF EXISTS trg_fin_cur_updated ON public.fin_currencies;
CREATE TRIGGER trg_fin_cur_updated BEFORE UPDATE ON public.fin_currencies
  FOR EACH ROW EXECUTE FUNCTION public.fin_set_updated_at();

DROP TRIGGER IF EXISTS trg_fin_tj_updated ON public.fin_tax_jurisdictions;
CREATE TRIGGER trg_fin_tj_updated BEFORE UPDATE ON public.fin_tax_jurisdictions
  FOR EACH ROW EXECUTE FUNCTION public.fin_set_updated_at();

DROP TRIGGER IF EXISTS trg_fin_jt_updated ON public.fin_journal_types;
CREATE TRIGGER trg_fin_jt_updated BEFORE UPDATE ON public.fin_journal_types
  FOR EACH ROW EXECUTE FUNCTION public.fin_set_updated_at();

DROP TRIGGER IF EXISTS trg_fin_pp_updated ON public.fin_posting_profiles;
CREATE TRIGGER trg_fin_pp_updated BEFORE UPDATE ON public.fin_posting_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fin_set_updated_at();
