-- Migration 384: Seed bank statement lines + reconciliation batches + petty cash floats + cash transactions
-- Backs the /erp/finance/cash_bank tab. bank_accounts already has 2 rows (CBE, BOA).
-- bank_statement_lines and reconciliation_batches tables exist but are empty.
-- petty_cash_floats and cash_transactions are new tables for the Cash Ops tab.

-- ── Update existing bank account balances ────────────────────────────────
UPDATE bank_accounts SET balance = 485000.00, current_balance = 485000.00, opening_balance = 500000.00 WHERE id = '41615893-7fd1-42ce-b493-d7504cad4674';
UPDATE bank_accounts SET balance = 125000.00, current_balance = 125000.00, opening_balance = 150000.00 WHERE id = '30a0c01b-334b-4802-9bc3-f778c7ceb1a2';

-- ── Seed bank_statement_lines ────────────────────────────────────────────
-- Status constraint: Unmatched, Matched, Partially Matched, Excluded
INSERT INTO public.bank_statement_lines (id, bank_account_id, statement_date, transaction_date, description, reference, debit, credit, balance, status, property_id)
VALUES
  ('bsl_001', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-01', 'Guest deposit - Corporate booking',       'DEP-001', 0,       15000,  515000, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_002', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-03', 'Vendor payment - Food Provisions Ltd',   'PMT-001', 8500,    0,      506500, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_003', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-05', 'Bank service charge - June',             'FEE-001', 500,     0,      506000, 'Unmatched',        '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_004', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-08', 'Guest payment - Wedding event',          'DEP-002', 0,       28000,  534000, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_005', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-10', 'Payroll transfer - June salaries',       'PAY-001', 95000,   0,      439000, 'Partially Matched','18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_006', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-15', 'Vendor payment - Apex Cleaning',         'PMT-002', 5000,    0,      434000, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_007', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-20', 'Utility bill - Ethiopian Electric',      'PMT-003', 9000,    0,      425000, 'Unmatched',        '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_008', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-25', 'Guest refund - Cancelled booking',       'REF-001', 1200,    0,      423800, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_009', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-28', 'OTA settlement - Booking.com',           'DEP-003', 0,       42000,  465800, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_010', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-30', '2024-06-30', 'Interest earned - June',                 'INT-001', 0,       1850,   467650, 'Unmatched',        '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_011', '30a0c01b-334b-4802-9bc3-f778c7ceb1a2', '2024-06-30', '2024-06-02', 'Opening deposit - BOA account',          'DEP-BOA', 0,       150000, 150000, 'Matched',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_012', '30a0c01b-334b-4802-9bc3-f778c7ceb1a2', '2024-06-30', '2024-06-12', 'Equipment purchase - Tech Equipment',    'PMT-BOA', 15000,   0,      135000, 'Partially Matched','18762279-a389-41c9-9169-7ebc682e9703'),
  ('bsl_013', '30a0c01b-334b-4802-9bc3-f778c7ceb1a2', '2024-06-30', '2024-06-22', 'Transfer to CBE operating account',      'TRF-001', 10000,   0,      125000, 'Unmatched',        '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed reconciliation_batches ──────────────────────────────────────────
-- Status constraint: Draft, Completed, Cancelled
INSERT INTO public.reconciliation_batches (id, bank_account_id, period_start, period_end, opening_balance, closing_balance, total_debits, total_credits, status, reconciled_by, reconciled_at)
VALUES
  ('rb_001', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-05-01', '2024-05-31', 520000, 500000, 75000, 55000, 'Completed', 'system', '2024-06-01 10:00:00+00'),
  ('rb_002', '41615893-7fd1-42ce-b493-d7504cad4674', '2024-06-01', '2024-06-30', 500000, 467650, 110200, 86850, 'Draft',     NULL,     NULL),
  ('rb_003', '30a0c01b-334b-4802-9bc3-f778c7ceb1a2', '2024-06-01', '2024-06-30', 150000, 125000, 25000, 0,     'Draft',     NULL,     NULL)
ON CONFLICT (id) DO NOTHING;

-- ── petty_cash_floats table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.petty_cash_floats (
  id              text PRIMARY KEY,
  department      text NOT NULL,
  float_code      text,
  float_amount    numeric DEFAULT 0,
  current_balance numeric DEFAULT 0,
  custodian       text,
  status          text DEFAULT 'Active' CHECK (status IN ('Active', 'Replenished', 'Closed')),
  property_id     uuid,
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.petty_cash_floats ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.petty_cash_floats TO authenticated;

INSERT INTO public.petty_cash_floats (id, department, float_code, float_amount, current_balance, custodian, status, property_id)
VALUES
  ('pcf_001', 'Front Office',  'PC-001', 5000, 3500, 'Sarah T.',  'Active',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pcf_002', 'F&B Kitchen',   'PC-002', 3000, 1200, 'Mike K.',    'Active',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pcf_003', 'Engineering',   'PC-003', 2000, 850,  'James B.',   'Active',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pcf_004', 'Housekeeping',  'PC-004', 1500, 420,  'Lisa M.',    'Active',     '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── cash_transactions table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_transactions (
  id              text PRIMARY KEY,
  type            text NOT NULL CHECK (type IN ('Receipt', 'Payment', 'Transfer')),
  description     text,
  amount          numeric DEFAULT 0,
  transaction_date date,
  reference       text,
  department      text,
  property_id     uuid,
  created_by      text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_transactions TO authenticated;

INSERT INTO public.cash_transactions (id, type, description, amount, transaction_date, reference, department, property_id)
VALUES
  ('ctx_001', 'Receipt',  'Guest cash payment — Room 412',           1200,  '2024-06-30', 'R-001', 'Front Office', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_002', 'Payment',  'Courier service payment',                 -85,   '2024-06-30', 'P-001', 'Front Office', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_003', 'Transfer', 'FO to Petty Cash replenishment',           -500,  '2024-06-30', 'T-001', 'Front Office', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_004', 'Receipt',  'F&B cash settlement',                      340,   '2024-06-30', 'R-002', 'F&B',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_005', 'Payment',  'Office supplies purchase',                 -120,  '2024-06-29', 'P-002', 'Operations',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_006', 'Receipt',  'Banquet event cash payment',               2500,  '2024-06-29', 'R-003', 'F&B',          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_007', 'Transfer', 'Bank deposit - cash receipts',             -3000, '2024-06-28', 'T-002', 'Front Office', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ctx_008', 'Payment',  'Emergency maintenance supplies',           -220,  '2024-06-28', 'P-003', 'Engineering',  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
