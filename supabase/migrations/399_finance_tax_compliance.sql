-- ============================================================
-- Finance — Tax Compliance: VAT, WHT, TOT, PAYE, Sales Tax,
-- Local taxes, Pension, Customs, and Audit findings
-- (Migration 399)
-- ============================================================
-- Brings the /erp/finance/tax tab fully online:
--   • fin_tax_returns    — unified tax returns (VAT/WHT/TOT/PAYE/Sales/Local)
--                          with tax_type discriminator + JSONB metadata
--   • fin_tax_pension    — pension remittance schedule
--   • fin_tax_customs    — customs declarations & duty payments
--   • fin_tax_audits     — tax audit findings & compliance tracking
-- All tables are property-scoped, RLS-enabled, and seeded with demo
-- rows so the tab has data on a fresh DB.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_tax_returns (VAT, WHT, TOT, PAYE, Sales Tax, Local taxes)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_tax_returns (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  return_number text,
  tax_type text NOT NULL CHECK (tax_type IN ('VAT','WHT','TOT','PAYE','Sales Tax','Local')),
  period text NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Filed','Paid','Draft','Cancelled')),
  filing_date date,
  due_date date,
  taxable_base numeric NOT NULL DEFAULT 0,
  tax_collected numeric NOT NULL DEFAULT 0,
  tax_paid numeric NOT NULL DEFAULT 0,
  net_tax numeric NOT NULL DEFAULT 0,
  tax_rate numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  filed_by text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_tax_ret_property ON public.fin_tax_returns(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_tax_ret_type ON public.fin_tax_returns(tax_type);
CREATE INDEX IF NOT EXISTS idx_fin_tax_ret_status ON public.fin_tax_returns(status);
CREATE INDEX IF NOT EXISTS idx_fin_tax_ret_period ON public.fin_tax_returns(period);

ALTER TABLE public.fin_tax_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_tax_returns" ON public.fin_tax_returns;
CREATE POLICY "authenticated can CRUD fin_tax_returns" ON public.fin_tax_returns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_tax_returns" ON public.fin_tax_returns;
CREATE POLICY "service_role all fin_tax_returns" ON public.fin_tax_returns
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_tax_returns TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_tax_pension (Pension remittance schedule)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_tax_pension (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  period text NOT NULL,
  employee_amount numeric NOT NULL DEFAULT 0,
  employer_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Remitted','Draft')),
  remittance_date date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_tax_pen_property ON public.fin_tax_pension(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_tax_pen_status ON public.fin_tax_pension(status);

ALTER TABLE public.fin_tax_pension ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_tax_pension" ON public.fin_tax_pension;
CREATE POLICY "authenticated can CRUD fin_tax_pension" ON public.fin_tax_pension
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_tax_pension" ON public.fin_tax_pension;
CREATE POLICY "service_role all fin_tax_pension" ON public.fin_tax_pension
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_tax_pension TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. fin_tax_customs (Customs declarations & duty payments)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_tax_customs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  declaration_number text,
  item_description text NOT NULL,
  cif_value numeric NOT NULL DEFAULT 0,
  duty_rate text,
  duty_paid numeric NOT NULL DEFAULT 0,
  declaration_date date,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Cleared','Draft')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_tax_cus_property ON public.fin_tax_customs(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_tax_cus_status ON public.fin_tax_customs(status);

ALTER TABLE public.fin_tax_customs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_tax_customs" ON public.fin_tax_customs;
CREATE POLICY "authenticated can CRUD fin_tax_customs" ON public.fin_tax_customs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_tax_customs" ON public.fin_tax_customs;
CREATE POLICY "service_role all fin_tax_customs" ON public.fin_tax_customs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_tax_customs TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 4. fin_tax_audits (Tax audit findings & compliance tracking)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_tax_audits (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  finding_number text,
  category text NOT NULL,
  description text,
  risk_level text NOT NULL DEFAULT 'Medium' CHECK (risk_level IN ('Low','Medium','High')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved','Closed')),
  due_date date,
  resolved_at timestamptz,
  resolved_by text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_tax_aud_property ON public.fin_tax_audits(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_tax_aud_status ON public.fin_tax_audits(status);
CREATE INDEX IF NOT EXISTS idx_fin_tax_aud_risk ON public.fin_tax_audits(risk_level);

ALTER TABLE public.fin_tax_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_tax_audits" ON public.fin_tax_audits;
CREATE POLICY "authenticated can CRUD fin_tax_audits" ON public.fin_tax_audits
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_tax_audits" ON public.fin_tax_audits;
CREATE POLICY "service_role all fin_tax_audits" ON public.fin_tax_audits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_tax_audits TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 5. Seed data
-- ════════════════════════════════════════════════════════════════

-- VAT returns seed
INSERT INTO public.fin_tax_returns (property_id, return_number, tax_type, period, status, filing_date, due_date, taxable_base, tax_collected, tax_paid, net_tax, tax_rate, metadata) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'VAT-2026-06', 'VAT', 'June 2026', 'Filed', '2026-07-15', '2026-07-20', 610500, 61050, 12500, 48550, 10, '{}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'VAT-2026-05', 'VAT', 'May 2026', 'Filed', '2026-06-18', '2026-06-20', 585200, 58520, 11200, 47320, 10, '{}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'VAT-2026-04', 'VAT', 'April 2026', 'Filed', '2026-05-17', '2026-05-20', 545800, 54580, 10800, 43780, 10, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- Withholding tax returns seed
INSERT INTO public.fin_tax_returns (property_id, return_number, tax_type, period, status, filing_date, due_date, taxable_base, tax_collected, tax_paid, net_tax, tax_rate, metadata) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WHT-2026-06', 'WHT', 'June 2026', 'Pending', null, '2026-07-20', 760000, 15200, 0, 15200, 2, '{"vendors": 8}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WHT-2026-05', 'WHT', 'May 2026', 'Filed', '2026-06-18', '2026-06-20', 740000, 14800, 0, 14800, 2, '{"vendors": 7}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'WHT-2026-04', 'WHT', 'April 2026', 'Filed', '2026-05-17', '2026-05-20', 675000, 13500, 0, 13500, 2, '{"vendors": 6}'::jsonb)
ON CONFLICT DO NOTHING;

-- TOT returns seed
INSERT INTO public.fin_tax_returns (property_id, return_number, tax_type, period, status, filing_date, due_date, taxable_base, tax_collected, tax_paid, net_tax, tax_rate, metadata) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'TOT-2026-Q2', 'TOT', 'Q2 2026', 'Pending', null, '2026-07-31', 1841500, 36830, 0, 36830, 2, '{}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'TOT-2026-Q1', 'TOT', 'Q1 2026', 'Filed', '2026-04-28', '2026-04-30', 1720500, 34410, 0, 34410, 2, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- PAYE returns seed
INSERT INTO public.fin_tax_returns (property_id, return_number, tax_type, period, status, filing_date, due_date, taxable_base, tax_collected, tax_paid, net_tax, tax_rate, metadata) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'PAYE-2026-06', 'PAYE', 'June 2026', 'Filed', '2026-07-10', '2026-07-10', 285000, 28500, 0, 28500, 10, '{"employees": 145, "grossSalary": 285000, "pensionDeducted": 22800}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'PAYE-2026-05', 'PAYE', 'May 2026', 'Filed', '2026-06-10', '2026-06-10', 278000, 27800, 0, 27800, 10, '{"employees": 142, "grossSalary": 278000, "pensionDeducted": 22240}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'PAYE-2026-04', 'PAYE', 'April 2026', 'Filed', '2026-05-10', '2026-05-10', 272000, 27200, 0, 27200, 10, '{"employees": 140, "grossSalary": 272000, "pensionDeducted": 21760}'::jsonb)
ON CONFLICT DO NOTHING;

-- Sales tax returns seed
INSERT INTO public.fin_tax_returns (property_id, return_number, tax_type, period, status, filing_date, due_date, taxable_base, tax_collected, tax_paid, net_tax, tax_rate, metadata) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ST-2026-06', 'Sales Tax', 'June 2026', 'Pending', null, '2026-07-15', 95000, 4750, 0, 4750, 5, '{}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ST-2026-05', 'Sales Tax', 'May 2026', 'Filed', '2026-06-15', '2026-06-15', 92000, 4600, 0, 4600, 5, '{}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ST-2026-04', 'Sales Tax', 'April 2026', 'Filed', '2026-05-15', '2026-05-15', 88000, 4400, 0, 4400, 5, '{}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ST-2026-03', 'Sales Tax', 'March 2026', 'Filed', '2026-04-15', '2026-04-15', 95000, 4750, 0, 4750, 5, '{}'::jsonb)
ON CONFLICT DO NOTHING;

-- Local tax payments seed
INSERT INTO public.fin_tax_returns (property_id, return_number, tax_type, period, status, filing_date, due_date, taxable_base, tax_collected, tax_paid, net_tax, tax_rate, metadata) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'LOC-2026-006', 'Local', 'June 2026', 'Pending', null, '2026-07-15', 0, 0, 4150, 4150, 0, '{"taxType": "Municipal Tax", "jurisdiction": "City of Addis Ababa"}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'LOC-2026-005', 'Local', 'June 2026', 'Pending', null, '2026-07-15', 0, 0, 2750, 2750, 0, '{"taxType": "Service Tax", "jurisdiction": "Bole Subcity"}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'LOC-2026-004', 'Local', 'May 2026', 'Paid', '2026-06-15', '2026-06-15', 0, 0, 4150, 4150, 0, '{"taxType": "Municipal Tax", "jurisdiction": "City of Addis Ababa"}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'LOC-2026-003', 'Local', 'Q2 2026', 'Paid', '2026-06-30', '2026-06-30', 0, 0, 5600, 5600, 0, '{"taxType": "Property Tax", "jurisdiction": "Kirkos Subcity"}'::jsonb),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'LOC-2026-002', 'Local', 'May 2026', 'Paid', '2026-06-15', '2026-06-15', 0, 0, 2650, 2650, 0, '{"taxType": "Service Tax", "jurisdiction": "Bole Subcity"}'::jsonb)
ON CONFLICT DO NOTHING;

-- Pension remittance seed
INSERT INTO public.fin_tax_pension (property_id, period, employee_amount, employer_amount, total_amount, status, remittance_date) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'June 2026', 22800, 31350, 54150, 'Pending', null),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'May 2026', 22240, 30580, 52820, 'Remitted', '2026-06-10'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'April 2026', 21760, 29920, 51680, 'Remitted', '2026-05-10')
ON CONFLICT DO NOTHING;

-- Customs declarations seed
INSERT INTO public.fin_tax_customs (property_id, declaration_number, item_description, cif_value, duty_rate, duty_paid, declaration_date, status) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'CD-2026-018', 'Kitchen Equipment Import', 45000, '15%', 6750, '2026-06-01', 'Cleared'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'CD-2026-017', 'IT Equipment Import', 28000, '10%', 2800, '2026-05-20', 'Cleared'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'CD-2026-016', 'Furniture Import', 35000, '12%', 4200, '2026-05-10', 'Cleared'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'CD-2026-019', 'HVAC System Import', 52000, '15%', 7800, '2026-06-05', 'Pending')
ON CONFLICT DO NOTHING;

-- Tax audit findings seed
INSERT INTO public.fin_tax_audits (property_id, finding_number, category, description, risk_level, status, due_date) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AUD-2026-001', 'VAT Compliance', 'Missing supporting documents for Q1 2026', 'Medium', 'Resolved', '2026-04-30'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AUD-2026-002', 'Withholding Tax', 'Vendor TIN verification incomplete', 'High', 'In Progress', '2026-07-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AUD-2026-003', 'PAYE Reporting', 'Minor discrepancy in employee deductions', 'Low', 'Resolved', '2026-05-15'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'AUD-2026-004', 'TOT Filing', 'Turnover calculation review needed', 'Medium', 'Open', '2026-07-31')
ON CONFLICT DO NOTHING;
