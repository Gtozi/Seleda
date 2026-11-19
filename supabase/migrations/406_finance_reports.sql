-- ============================================================
-- Finance — Financial Reports
-- (Migration 406)
-- ============================================================
-- Brings /erp/finance/reports fully online.
-- Creates:
--   • fin_reports         — report catalog (categories, metadata, status)
--   • fin_report_runs     — report execution/generation log
-- All tables are RLS-enabled and seeded with demo rows.
-- ============================================================

-- Demo property: '18762279-a389-41c9-9169-7ebc682e9703' = Gheralta Main Property

-- ════════════════════════════════════════════════════════════════
-- 1. fin_reports (catalog)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  report_key text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  period text,
  status text NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
    'Ready','Scheduled','Generating','Failed'
  )),
  format text NOT NULL DEFAULT 'PDF' CHECK (format IN ('PDF','Excel','CSV')),
  frequency text NOT NULL DEFAULT 'Manual',
  last_run_at timestamptz,
  last_run_by text,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_reports_property ON public.fin_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_reports_category ON public.fin_reports(category);
CREATE INDEX IF NOT EXISTS idx_fin_reports_status ON public.fin_reports(status);
CREATE INDEX IF NOT EXISTS idx_fin_reports_key ON public.fin_reports(report_key);

ALTER TABLE public.fin_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_reports" ON public.fin_reports;
CREATE POLICY "authenticated can CRUD fin_reports" ON public.fin_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_reports" ON public.fin_reports;
CREATE POLICY "service_role all fin_reports" ON public.fin_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_reports TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 2. fin_report_runs (execution log)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fin_report_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  report_id text,
  report_key text,
  report_title text,
  generated_by text,
  status text NOT NULL DEFAULT 'Ready' CHECK (status IN (
    'Ready','Scheduled','Generating','Failed'
  )),
  format text NOT NULL DEFAULT 'PDF' CHECK (format IN ('PDF','Excel','CSV')),
  file_url text,
  file_size bigint NOT NULL DEFAULT 0,
  parameters jsonb,
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_rr_property ON public.fin_report_runs(property_id);
CREATE INDEX IF NOT EXISTS idx_fin_rr_report_id ON public.fin_report_runs(report_id);
CREATE INDEX IF NOT EXISTS idx_fin_rr_status ON public.fin_report_runs(status);
CREATE INDEX IF NOT EXISTS idx_fin_rr_created_at ON public.fin_report_runs(created_at DESC);

ALTER TABLE public.fin_report_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can CRUD fin_report_runs" ON public.fin_report_runs;
CREATE POLICY "authenticated can CRUD fin_report_runs" ON public.fin_report_runs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_role all fin_report_runs" ON public.fin_report_runs;
CREATE POLICY "service_role all fin_report_runs" ON public.fin_report_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fin_report_runs TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- 3. updated_at trigger
-- ════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_fin_reports_updated_at ON public.fin_reports;
CREATE OR REPLACE FUNCTION public.set_fin_reports_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_fin_reports_updated_at
  BEFORE UPDATE ON public.fin_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_fin_reports_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 4. Seed demo report catalog
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 4. Seed demo report catalog (aligned to Finance Portal new.md §25)
-- ════════════════════════════════════════════════════════════════

-- Financial Statements (spec: Balance Sheet, Income Statement, Cash Flow Statement, Statement of Changes in Equity, Trial Balance)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'bs', 'Balance Sheet', 'Financial Statements', 'April 2024', 'Ready', 'PDF', 'Monthly', '2024-05-01 09:15:00+03', 'controller@erp.com', 1, 'Statement of financial position'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'pl', 'Income Statement (Profit & Loss)', 'Financial Statements', 'Q1 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-04-28 14:00:00+03', 'cfo@erp.com', 2, 'Profit & Loss statement'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cf', 'Cash Flow Statement', 'Financial Statements', 'M-TD May', 'Ready', 'PDF', 'Monthly', '2024-05-15 08:30:00+03', 'staff@erp.com', 3, 'Cash flow statement'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'equity', 'Statement of Changes in Equity', 'Financial Statements', 'Q1 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-04-28 15:00:00+03', 'staff@erp.com', 4, 'Changes in equity statement'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'tb', 'Trial Balance', 'Financial Statements', 'April 2024', 'Ready', 'PDF', 'Monthly', '2024-05-01 09:00:00+03', 'controller@erp.com', 5, 'Trial balance'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'comprehensive', 'Comprehensive Income', 'Financial Statements', 'Q1 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-04-28 15:30:00+03', 'staff@erp.com', 6, 'Comprehensive income statement')
ON CONFLICT (id) DO NOTHING;

-- General Ledger Reports (spec: General Ledger, Journal Register, Trial Balance, Account Activity, Audit Trail)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'general_ledger', 'General Ledger', 'General Ledger Reports', 'May 2024', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 1, 'Full general ledger report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'je_register', 'Journal Register', 'General Ledger Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 08:00:00+03', 'staff@erp.com', 2, 'Journal register'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'gl_tb', 'Trial Balance', 'General Ledger Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 3, 'Trial balance under General Ledger'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'account_activity', 'Account Activity', 'General Ledger Reports', 'May 2024', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 4, 'Account activity report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'audit_trail', 'Audit Trail', 'General Ledger Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 06:00:00+03', 'staff@erp.com', 5, 'Audit trail'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'gl_detail', 'GL Detail Report', 'General Ledger Reports', 'May 2024', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 6, 'Detailed GL report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'gl_summary', 'GL Summary Report', 'General Ledger Reports', 'May 2024', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 7, 'Summary GL report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'je_report', 'Journal Entry Report', 'General Ledger Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 08:00:00+03', 'staff@erp.com', 8, 'Journal entry report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'coa_report', 'Chart of Accounts Listing', 'General Ledger Reports', 'Current', 'Ready', 'PDF', 'Daily', '2024-05-15 00:00:00+03', 'system', 9, 'Chart of accounts listing')
ON CONFLICT (id) DO NOTHING;

-- Accounts Receivable Reports (spec: AR Aging, Customer Statement, Outstanding Invoices, Collection Report)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar', 'AR Aging', 'Accounts Receivable Reports', 'Current', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 1, 'Accounts receivable aging'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'customer_statement', 'Customer Statement', 'Accounts Receivable Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 2, 'Customer statement'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'outstanding_invoices', 'Outstanding Invoices', 'Accounts Receivable Reports', 'Current', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 3, 'All outstanding AR invoices'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'collection_report', 'Collection Report', 'Accounts Receivable Reports', 'Q2 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 4, 'Collection report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar_ledger', 'AR Ledger Report', 'Accounts Receivable Reports', 'May 2024', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 5, 'AR ledger report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar_collection', 'Collection Analysis', 'Accounts Receivable Reports', 'Q2 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 6, 'Collection analysis'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar_writeoff', 'Bad Debt Write-off Report', 'Accounts Receivable Reports', 'YTD 2024', 'Scheduled', 'PDF', 'Yearly', '2024-05-10 10:00:00+03', 'staff@erp.com', 7, 'Bad debt write-off report')
ON CONFLICT (id) DO NOTHING;

-- Accounts Payable Reports (spec: AP Aging, Vendor Statement, Payment Schedule, Outstanding Bills)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap_aging', 'AP Aging', 'Accounts Payable Reports', 'Current', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 1, 'Accounts payable aging'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'vendor_statement', 'Vendor Statement', 'Accounts Payable Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 2, 'Vendor statement'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'payment_schedule', 'Payment Schedule', 'Accounts Payable Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 06:00:00+03', 'staff@erp.com', 3, 'Payment schedule'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'outstanding_bills', 'Outstanding Bills', 'Accounts Payable Reports', 'Current', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 4, 'Outstanding bills'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap_ledger', 'AP Ledger Report', 'Accounts Payable Reports', 'May 2024', 'Ready', 'Excel', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 5, 'AP ledger report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap_payment', 'Payment History Report', 'Accounts Payable Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 06:00:00+03', 'staff@erp.com', 6, 'Payment history report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap_vendor', 'Vendor Spending Analysis', 'Accounts Payable Reports', 'Q2 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 7, 'Vendor spending analysis')
ON CONFLICT (id) DO NOTHING;

-- Cash & Bank Reports (spec: Bank Reconciliation, Cash Book, Bank Book, Cash Flow Forecast)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'bank_recon', 'Bank Reconciliation', 'Cash & Bank Reports', 'May 2024', 'Scheduled', 'PDF', 'Monthly', '2024-05-15 06:00:00+03', 'controller@erp.com', 1, 'Bank reconciliation report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cash_book', 'Cash Book', 'Cash & Bank Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 2, 'Cash book'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'bank_book', 'Bank Book', 'Cash & Bank Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 3, 'Bank book'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cash_flow_forecast', 'Cash Flow Forecast', 'Cash & Bank Reports', 'Q3 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 4, 'Cash flow forecast'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cash_flow', 'Daily Cash Flow', 'Cash & Bank Reports', 'Today', 'Ready', 'PDF', 'Daily', '2024-05-15 08:25:00+03', 'system', 5, 'Daily cash flow'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'petty_cash', 'Petty Cash Report', 'Cash & Bank Reports', 'May 2024', 'Ready', 'PDF', 'Daily', '2024-05-15 07:00:00+03', 'staff@erp.com', 6, 'Petty cash report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'bank_position', 'Bank Position Report', 'Cash & Bank Reports', 'Current', 'Ready', 'Excel', 'Daily', '2024-05-15 08:20:00+03', 'system', 7, 'Bank position report')
ON CONFLICT (id) DO NOTHING;

-- Budget Reports (spec: Budget vs Actual, Variance Analysis, Forecast Report)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'budget_var', 'Budget vs Actual', 'Budget Reports', 'May 2024', 'Ready', 'Excel', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 1, 'Budget vs actual variance'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'variance_analysis', 'Variance Analysis', 'Budget Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 2, 'Variance analysis'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'forecast_report', 'Forecast Report', 'Budget Reports', 'Q3 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 3, 'Forecast report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'forecast', 'Rolling Forecast Report', 'Budget Reports', 'Q3 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 4, 'Rolling forecast report')
ON CONFLICT (id) DO NOTHING;

-- Asset Reports (spec: Asset Register, Depreciation Schedule, Asset Movement, Asset Disposal)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'asset_reg', 'Asset Register', 'Asset Reports', 'Current', 'Ready', 'Excel', 'Daily', '2024-05-15 00:00:00+03', 'system', 1, 'Fixed asset register'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'asset_dep', 'Depreciation Schedule', 'Asset Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 2, 'Depreciation schedule'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'asset_movement', 'Asset Movement', 'Asset Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 3, 'Asset movement report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'asset_disposal', 'Asset Disposal', 'Asset Reports', 'YTD 2024', 'Scheduled', 'PDF', 'Yearly', '2024-05-10 10:00:00+03', 'staff@erp.com', 4, 'Asset disposal report')
ON CONFLICT (id) DO NOTHING;

-- Tax Reports (spec: VAT Report, Withholding Tax Report, Tax Summary, Tax Filing Report)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'vat_report', 'VAT Report', 'Tax Reports', 'June 2024', 'Scheduled', 'PDF', 'Monthly', '2024-05-14 12:00:00+03', 'staff@erp.com', 1, 'VAT return report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'wht_report', 'Withholding Tax Report', 'Tax Reports', 'June 2024', 'Scheduled', 'PDF', 'Monthly', '2024-05-14 12:00:00+03', 'staff@erp.com', 2, 'Withholding tax report'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'tax_summary', 'Tax Summary', 'Tax Reports', 'Q2 2024', 'Scheduled', 'PDF', 'Quarterly', '2024-05-14 12:00:00+03', 'staff@erp.com', 3, 'Tax summary'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'tax_filing', 'Tax Filing Report', 'Tax Reports', 'June 2024', 'Scheduled', 'PDF', 'Monthly', '2024-05-14 12:00:00+03', 'staff@erp.com', 4, 'Tax filing report')
ON CONFLICT (id) DO NOTHING;

-- Department Reports (spec: Department Profit & Loss, Cost Center Analysis, Profit Center Analysis)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'dept_pl', 'Department Profit & Loss', 'Department Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 1, 'Department P&L'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cost_center_analysis', 'Cost Center Analysis', 'Department Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 06:00:00+03', 'staff@erp.com', 2, 'Cost center analysis'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'profit_center_analysis', 'Profit Center Analysis', 'Department Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 3, 'Profit center analysis'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'cost_center', 'Cost Center Report', 'Department Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 06:00:00+03', 'staff@erp.com', 4, 'Cost center report')
ON CONFLICT (id) DO NOTHING;

-- Revenue Reports (supplementary — not in §25 spec but useful)
INSERT INTO public.fin_reports (property_id, report_key, title, category, period, status, format, frequency, last_run_at, last_run_by, sort_order, description) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'dr', 'Daily Revenue Summary', 'Revenue Reports', '2024-05-15', 'Ready', 'PDF', 'Daily', '2024-05-15 08:25:00+03', 'system', 1, 'Daily revenue summary'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'rev_dept', 'Revenue by Department', 'Revenue Reports', 'May 2024', 'Ready', 'Excel', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 2, 'Revenue by department'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'rev_source', 'Revenue by Source', 'Revenue Reports', 'May 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 07:00:00+03', 'staff@erp.com', 3, 'Revenue by source'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'rev_trend', 'Revenue Trend Analysis', 'Revenue Reports', 'H1 2024', 'Ready', 'PDF', 'Monthly', '2024-05-15 00:00:00+03', 'system', 4, 'Revenue trend analysis')
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 5. Seed demo report runs
-- ════════════════════════════════════════════════════════════════
INSERT INTO public.fin_report_runs (property_id, report_key, report_title, generated_by, status, format, file_size, created_at) VALUES
  ('18762279-a389-41c9-9169-7ebc682e9703', 'tb', 'Trial Balance', 'controller@erp.com', 'Ready', 'PDF', 245632, '2024-05-01 09:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'bs', 'Balance Sheet', 'controller@erp.com', 'Ready', 'PDF', 318400, '2024-05-01 09:15:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'pl', 'Income Statement (Profit & Loss)', 'cfo@erp.com', 'Ready', 'PDF', 287200, '2024-04-28 14:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'general_ledger', 'General Ledger', 'staff@erp.com', 'Ready', 'Excel', 512000, '2024-05-15 07:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ar', 'AR Aging', 'staff@erp.com', 'Ready', 'Excel', 128400, '2024-05-15 07:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'ap_aging', 'AP Aging', 'staff@erp.com', 'Ready', 'Excel', 96800, '2024-05-15 07:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'dr', 'Daily Revenue Summary', 'system', 'Ready', 'PDF', 64200, '2024-05-15 08:25:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'vat_report', 'VAT Report', 'staff@erp.com', 'Failed', 'PDF', 0, '2024-05-14 12:00:00+03')
ON CONFLICT (id) DO NOTHING;
