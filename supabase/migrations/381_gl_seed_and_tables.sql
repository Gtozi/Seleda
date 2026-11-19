-- Migration 381: General Ledger placeholder tables + seed data
-- Backs the /erp/finance/gl tab. Seeds the mock data that was previously
-- hardcoded in GeneralLedger.tsx useState/inline arrays, and adds dedicated
-- tables for the GL sub-modules (recurring templates, AP/AR invoices,
-- reversing/adjusting/closing entries, audit trail). Journal entries and
-- accounting periods reuse the existing tables (journal_entries / journal_lines
-- / accounting_periods) — this migration only seeds them.
--
-- Demo property: 18762279-a389-41c9-9169-7ebc682e9703 (Gheralta Main Property).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounting_periods' AND column_name='journal_count') THEN
    ALTER TABLE public.accounting_periods ADD COLUMN journal_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ── gl_recurring_templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_recurring_templates (
  id              text PRIMARY KEY DEFAULT ('rj_' || gen_random_uuid()::text),
  template_number text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  frequency       text NOT NULL DEFAULT 'Monthly',
  next_run        date NOT NULL,
  amount          numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'Active',
  property_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_recurring_status_chk CHECK (status IN ('Active','Paused','Inactive'))
);
ALTER TABLE public.gl_recurring_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_recurring_templates TO authenticated;

-- ── gl_invoices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_invoices (
  id             text PRIMARY KEY DEFAULT ('inv_' || gen_random_uuid()::text),
  invoice_number text NOT NULL UNIQUE,
  type           text NOT NULL,
  entity         text NOT NULL,
  issue_date     date NOT NULL,
  net_amount     numeric NOT NULL DEFAULT 0,
  tax_amount     numeric NOT NULL DEFAULT 0,
  gl_status      text NOT NULL DEFAULT 'Draft',
  gl_ref         text,
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  property_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_invoice_status_chk CHECK (gl_status IN ('Posted','Pending','Draft'))
);
ALTER TABLE public.gl_invoices ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_invoices TO authenticated;

-- ── gl_reversing_entries ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_reversing_entries (
  id              text PRIMARY KEY DEFAULT ('rev_' || gen_random_uuid()::text),
  entry_number    text NOT NULL UNIQUE,
  original_journal text NOT NULL,
  reason          text NOT NULL,
  reversal_date   date NOT NULL,
  amount          numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'Pending',
  property_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_rev_status_chk CHECK (status IN ('Pending','Posted'))
);
ALTER TABLE public.gl_reversing_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_reversing_entries TO authenticated;

-- ── gl_adjusting_entries ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_adjusting_entries (
  id             text PRIMARY KEY DEFAULT ('adj_' || gen_random_uuid()::text),
  entry_number   text NOT NULL UNIQUE,
  description    text NOT NULL,
  adjustment_type text NOT NULL,
  amount         numeric NOT NULL DEFAULT 0,
  created_by     text,
  status         text NOT NULL DEFAULT 'Pending',
  property_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_adj_type_chk CHECK (adjustment_type IN ('Accrual','Deferral','Correction')),
  CONSTRAINT gl_adj_status_chk CHECK (status IN ('Pending','Posted'))
);
ALTER TABLE public.gl_adjusting_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_adjusting_entries TO authenticated;

-- ── gl_closing_entries ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_closing_entries (
  id             text PRIMARY KEY DEFAULT ('cl_' || gen_random_uuid()::text),
  entry_number   text NOT NULL UNIQUE,
  period         text NOT NULL,
  closing_type   text NOT NULL,
  revenue_closed numeric NOT NULL DEFAULT 0,
  expense_closed numeric NOT NULL DEFAULT 0,
  net_income     numeric NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'Pending',
  property_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_close_type_chk CHECK (closing_type IN ('Month-End','Quarter-End','Year-End')),
  CONSTRAINT gl_close_status_chk CHECK (status IN ('Pending','Posted'))
);
ALTER TABLE public.gl_closing_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gl_closing_entries TO authenticated;

-- ── gl_audit_trail ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gl_audit_trail (
  id          text PRIMARY KEY DEFAULT ('audit_' || gen_random_uuid()::text),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  journal_id  text NOT NULL,
  action      text NOT NULL,
  description text,
  amount      numeric NOT NULL DEFAULT 0,
  user_name   text,
  ip_address  text,
  property_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gl_audit_action_chk CHECK (action IN ('Created','Posted','Modified','Reversed','Approved','Deleted'))
);
ALTER TABLE public.gl_audit_trail ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.gl_audit_trail TO authenticated;

-- ── Seed: accounting_periods (table already exists) ──────────────────────
INSERT INTO public.accounting_periods (id, period_name, period_start, period_end, status, journal_count, property_id)
VALUES
  ('ap_2024_01', 'January 2024', '2024-01-01', '2024-01-31', 'Closed', 142, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ap_2024_02', 'February 2024', '2024-02-01', '2024-02-29', 'Closed', 128, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ap_2024_03', 'March 2024', '2024-03-01', '2024-03-31', 'Closed', 156, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ap_2024_04', 'April 2024', '2024-04-01', '2024-04-30', 'Closed', 134, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ap_2024_05', 'May 2024', '2024-05-01', '2024-05-31', 'Closing', 145, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ap_2024_06', 'June 2024', '2024-06-01', '2024-06-30', 'Open', 89, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: journal_entries + journal_lines (4 mock journals) ──────────────
INSERT INTO public.journal_entries (id, entry_date, reference, description, status, created_by, approved_by, amount, lines, attachments, department, period, source, total_debit, total_credit, posted_at, property_id)
VALUES
  ('je_seed_jv202405001', '2024-05-28', 'INV-FB-492', 'Monthly F&B Supplier Payment Posting', 'Posted', 'Sarah Accountant', 'Finance Manager', 14200.50,
    '[{"id":"1","accountId":"1010","accountName":"Cash on Hand","description":"Payment Received","debit":14200.50,"credit":0},{"id":"2","accountId":"4010","accountName":"F&B Revenue","description":"Revenue Recognition","debit":0,"credit":14200.50}]'::jsonb,
    '{}'::text[], 'F&B', '2024-05', 'Manual', 14200.50, 14200.50, '2024-05-28T11:00:00Z', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('je_seed_jv202405002', '2024-05-29', 'UTIL-MAY-01', 'Accrued Electricity Charges May', 'Draft', 'John Doe', null, 4500.00,
    '[]'::jsonb, '{}'::text[], 'Engineering', '2024-05', 'Manual', 4500.00, 4500.00, null, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('je_seed_jv202405003', '2024-05-30', 'PR-MAY-24', 'Payroll Disbursements Executive', 'Pending', 'Elena Finance', null, 85000.00,
    '[]'::jsonb, '{}'::text[], 'HR', '2024-05', 'Manual', 85000.00, 85000.00, null, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('je_seed_jv202405004', '2024-05-31', 'MAINT-JUN-01', 'Prepaid Maintenance Contract', 'Approved', 'Michael Accountant', 'Finance Manager', 12000.00,
    '[{"id":"1","accountId":"1510","accountName":"Prepaid Expenses","description":"Annual Maintenance Contract","debit":12000.00,"credit":0},{"id":"2","accountId":"1010","accountName":"Cash on Hand","description":"Payment for Maintenance","debit":0,"credit":12000.00}]'::jsonb,
    '{}'::text[], 'Engineering', '2024-05', 'Manual', 12000.00, 12000.00, null, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- NOTE: journal_lines is NOT seeded here. The journal_lines table has a FK
-- to chart_of_accounts (which is empty on a fresh DB — the live COA lives in
-- usali_chart_of_accounts). The line breakdown is stored in the
-- journal_entries.lines JSONB column instead, which the GL portal reads
-- directly. This avoids the FK constraint without requiring a COA backfill.

-- ── Seed: gl_recurring_templates ─────────────────────────────────────────
INSERT INTO public.gl_recurring_templates (id, template_number, name, description, frequency, next_run, amount, status, property_id)
VALUES
  ('rj_seed_001', 'RJ-001', 'Monthly Rent Accrual', 'Office rent expense accrual', 'Monthly', '2024-06-01', 15000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rj_seed_002', 'RJ-002', 'Payroll Accrual', 'Monthly payroll accrual', 'Monthly', '2024-06-01', 85000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rj_seed_003', 'RJ-003', 'Depreciation Entry', 'Fixed asset depreciation', 'Monthly', '2024-06-01', 12000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rj_seed_004', 'RJ-004', 'Insurance Premium', 'Quarterly insurance payment', 'Quarterly', '2024-06-15', 4500, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rj_seed_005', 'RJ-005', 'Utility Accrual', 'Weekly utility expense accrual', 'Weekly', '2024-06-03', 2500, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rj_seed_006', 'RJ-006', 'Subscription Renewal', 'Software subscription', 'Monthly', '2024-06-10', 1200, 'Paused', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: gl_invoices ────────────────────────────────────────────────────
INSERT INTO public.gl_invoices (id, invoice_number, type, entity, issue_date, net_amount, tax_amount, gl_status, gl_ref, items, property_id)
VALUES
  ('inv_seed_001', 'INV-2026-001', 'Guest Folio', 'John Smith (Room 402)', '2026-06-03', 1250.00, 187.50, 'Posted', 'JV-2026-8821',
    '[{"desc":"Room Tariff (3 Nights)","qty":3,"rate":350,"total":1050},{"desc":"Room Service - Dinner","qty":1,"rate":125,"total":125},{"desc":"Spa Treatment - Swedish","qty":1,"rate":75,"total":75}]'::jsonb,
    '18762279-a389-41c9-9169-7ebc682e9703'),
  ('inv_seed_002', 'INV-2026-002', 'Vendor Bill', 'Apex Cleaning Supplies', '2026-06-02', 4500.00, 0.00, 'Pending', '-',
    '[{"desc":"Industrial Detergent (20L)","qty":10,"rate":250,"total":2500},{"desc":"Microfiber Towel Set","qty":50,"rate":20,"total":1000},{"desc":"Disinfectant Spray 500ml","qty":100,"rate":10,"total":1000}]'::jsonb,
    '18762279-a389-41c9-9169-7ebc682e9703'),
  ('inv_seed_003', 'INV-2026-003', 'Guest Folio', 'TechCorp Group', '2026-06-01', 15400.00, 2310.00, 'Posted', 'JV-2026-8840',
    '[{"desc":"Conference Room Rental","qty":2,"rate":2500,"total":5000},{"desc":"Executive Catering Package","qty":40,"rate":150,"total":6000},{"desc":"Audio Visual Support","qty":1,"rate":4400,"total":4400}]'::jsonb,
    '18762279-a389-41c9-9169-7ebc682e9703'),
  ('inv_seed_004', 'INV-2026-004', 'Maintenance Bill', 'Elevator Pro Services', '2026-05-31', 850.00, 127.50, 'Draft', '-',
    '[{"desc":"Monthly Preventative Maintenance","qty":1,"rate":850,"total":850}]'::jsonb,
    '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: gl_reversing_entries ───────────────────────────────────────────
INSERT INTO public.gl_reversing_entries (id, entry_number, original_journal, reason, reversal_date, amount, status, property_id)
VALUES
  ('rev_seed_003', 'REV-2024-003', 'JV-2024-05-089', 'Correction of accrual error', '2024-06-15', 8500, 'Pending', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_seed_002', 'REV-2024-002', 'JV-2024-05-075', 'Duplicate entry reversal', '2024-06-10', 12400, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rev_seed_001', 'REV-2024-001', 'JV-2024-05-062', 'Prepayment adjustment', '2024-06-05', 5000, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: gl_adjusting_entries ───────────────────────────────────────────
INSERT INTO public.gl_adjusting_entries (id, entry_number, description, adjustment_type, amount, created_by, status, property_id)
VALUES
  ('adj_seed_005', 'ADJ-2024-005', 'Q2 Revenue Adjustment', 'Accrual', 15000, 'Sarah Accountant', 'Pending', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('adj_seed_004', 'ADJ-2024-004', 'Prepaid Expense Deferral', 'Deferral', 8500, 'John Doe', 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('adj_seed_003', 'ADJ-2024-003', 'Inventory Valuation Adjustment', 'Correction', 4200, 'Michael Accountant', 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('adj_seed_002', 'ADJ-2024-002', 'Bad Debt Provision', 'Accrual', 12000, 'Elena Finance', 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('adj_seed_001', 'ADJ-2024-001', 'Depreciation Adjustment', 'Correction', 3500, 'Sarah Accountant', 'Posted', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: gl_closing_entries ─────────────────────────────────────────────
INSERT INTO public.gl_closing_entries (id, entry_number, period, closing_type, revenue_closed, expense_closed, net_income, status, property_id)
VALUES
  ('cl_seed_005', 'CL-2024-005', 'May 2024', 'Month-End', 285000, 245000, 40000, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cl_seed_004', 'CL-2024-004', 'April 2024', 'Month-End', 278000, 238000, 40000, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cl_seed_003', 'CL-2024-003', 'March 2024', 'Quarter-End', 845000, 715000, 130000, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cl_seed_002', 'CL-2024-002', 'February 2024', 'Month-End', 265000, 228000, 37000, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cl_seed_001', 'CL-2024-001', 'January 2024', 'Month-End', 258000, 222000, 36000, 'Posted', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed: gl_audit_trail ─────────────────────────────────────────────────
INSERT INTO public.gl_audit_trail (id, occurred_at, journal_id, action, description, amount, user_name, ip_address, property_id)
VALUES
  ('audit_seed_008', '2024-06-30 14:32:15+00', 'JV-2024-06-089', 'Posted', 'Monthly rent payment', 15000, 'Sarah Accountant', '192.168.1.45', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_007', '2024-06-30 14:28:42+00', 'JV-2024-06-088', 'Created', 'Utility expense accrual', 4500, 'John Doe', '192.168.1.46', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_006', '2024-06-30 14:15:33+00', 'JV-2024-06-087', 'Modified', 'Correction of entry amount', 8500, 'Michael Accountant', '192.168.1.47', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_005', '2024-06-30 13:45:21+00', 'REV-2024-003', 'Reversed', 'Reversal of JV-2024-05-089', 8500, 'Elena Finance', '192.168.1.48', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_004', '2024-06-30 13:22:18+00', 'JV-2024-06-086', 'Posted', 'Payroll disbursement', 85000, 'Sarah Accountant', '192.168.1.45', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_003', '2024-06-30 12:55:07+00', 'JV-2024-06-085', 'Created', 'Accounts receivable posting', 12500, 'John Doe', '192.168.1.46', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_002', '2024-06-30 12:30:45+00', 'JV-2024-06-084', 'Posted', 'Vendor payment processing', 24500, 'Michael Accountant', '192.168.1.47', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('audit_seed_001', '2024-06-30 11:15:33+00', 'ADJ-2024-005', 'Created', 'Q2 revenue adjustment', 15000, 'Elena Finance', '192.168.1.48', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
