-- Migration 391: Treasury Management tables + seed data
-- Backs the /erp/finance/treasury tab. Replaces the mock/placeholder data in
-- TreasuryManagement.tsx with persistent, DB-backed records.
-- Tables: treasury_cash_forecasts, treasury_investments, treasury_loans,
--         treasury_fx_rates, treasury_fx_transactions,
--         treasury_liquidity_forecasts, treasury_cash_pool_participants

-- ── treasury_cash_forecasts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_cash_forecasts (
  id              text PRIMARY KEY,
  period          text NOT NULL,
  opening_balance numeric DEFAULT 0,
  inflows         numeric DEFAULT 0,
  outflows        numeric DEFAULT 0,
  net_cash_flow   numeric DEFAULT 0,
  closing_balance numeric DEFAULT 0,
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_cash_forecasts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_cash_forecasts TO authenticated;

INSERT INTO public.treasury_cash_forecasts (id, period, opening_balance, inflows, outflows, net_cash_flow, closing_balance, property_id)
VALUES
  ('tcf_001', '2024-07', 485000, 320000, 280000,  40000,  525000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcf_002', '2024-08', 525000, 295000, 310000, -15000,  510000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcf_003', '2024-09', 510000, 410000, 340000,  70000,  580000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcf_004', '2024-10', 580000, 380000, 365000,  15000,  595000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcf_005', '2024-11', 595000, 450000, 390000,  60000,  655000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcf_006', '2024-12', 655000, 520000, 420000, 100000,  755000, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── treasury_investments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_investments (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  type            text DEFAULT 'Term Deposit',
  amount          numeric DEFAULT 0,
  maturity_date   date,
  interest_rate   numeric DEFAULT 0,
  status          text DEFAULT 'active' CHECK (status IN ('active', 'matured', 'redeemed')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_investments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_investments TO authenticated;

INSERT INTO public.treasury_investments (id, name, type, amount, maturity_date, interest_rate, status, property_id)
VALUES
  ('tin_001', 'CBE Term Deposit - 90 Day',     'Term Deposit',  500000, '2024-09-15', 8.5,  'active',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tin_002', 'Awash Bank T-Bill - 182 Day',   'Treasury Bill', 300000, '2024-11-20', 9.2,  'active',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tin_003', 'Dashen Bank CD - 365 Day',      'Certificate of Deposit', 200000, '2025-01-10', 10.0, 'active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tin_004', 'CBE Term Deposit - 30 Day',     'Term Deposit',  150000, '2024-06-30', 7.0,  'matured',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tin_005', 'Government Bond - 2 Year',      'Government Bond', 750000, '2025-08-01', 11.5, 'active',  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── treasury_loans ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_loans (
  id                text PRIMARY KEY,
  lender            text NOT NULL,
  principal         numeric DEFAULT 0,
  interest_rate     numeric DEFAULT 0,
  outstanding_balance numeric DEFAULT 0,
  next_payment_date date,
  monthly_payment   numeric DEFAULT 0,
  status            text DEFAULT 'active' CHECK (status IN ('active', 'paid', 'defaulted')),
  property_id       uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_loans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_loans TO authenticated;

INSERT INTO public.treasury_loans (id, lender, principal, interest_rate, outstanding_balance, next_payment_date, monthly_payment, status, property_id)
VALUES
  ('tln_001', 'Commercial Bank of Ethiopia', 5000000, 12.5, 3200000, '2024-07-15', 85000,  'active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tln_002', 'Awash Bank',                  2000000, 14.0, 1450000, '2024-07-10', 42000,  'active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tln_003', 'Dashen Bank',                 1000000, 13.0,       0, '2024-05-01',     0,  'paid',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tln_004', 'Development Bank of Ethiopia',8000000,  9.5, 6500000, '2024-07-20', 95000,  'active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── treasury_fx_rates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_fx_rates (
  id              text PRIMARY KEY,
  currency        text NOT NULL,
  rate            numeric DEFAULT 0,
  change_pct      numeric DEFAULT 0,
  last_updated    timestamptz DEFAULT now(),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_fx_rates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_fx_rates TO authenticated;

INSERT INTO public.treasury_fx_rates (id, currency, rate, change_pct, last_updated, property_id)
VALUES
  ('tfx_001', 'USD', 1.00,  0.0, now(), '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tfx_002', 'EUR', 0.92,  0.5, now(), '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tfx_003', 'GBP', 0.79, -0.3, now(), '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tfx_004', 'ETB', 57.50, 1.2, now(), '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── treasury_fx_transactions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_fx_transactions (
  id              text PRIMARY KEY,
  from_currency   text NOT NULL,
  to_currency     text NOT NULL,
  amount          numeric DEFAULT 0,
  rate            numeric DEFAULT 0,
  converted_amount numeric DEFAULT 0,
  transaction_date date,
  status          text DEFAULT 'Completed' CHECK (status IN ('Completed', 'Pending', 'Cancelled')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_fx_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_fx_transactions TO authenticated;

INSERT INTO public.treasury_fx_transactions (id, from_currency, to_currency, amount, rate, converted_amount, transaction_date, status, property_id)
VALUES
  ('tfxt_001', 'ETB', 'USD', 575000, 57.50, 10000,  '2024-06-15', 'Completed', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tfxt_002', 'USD', 'ETB', 5000,   57.50, 287500, '2024-06-20', 'Completed', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tfxt_003', 'EUR', 'USD', 10000,  1.087, 10870,  '2024-06-25', 'Completed', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── treasury_liquidity_forecasts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_liquidity_forecasts (
  id              text PRIMARY KEY,
  week_label      text NOT NULL,
  opening         numeric DEFAULT 0,
  inflows         numeric DEFAULT 0,
  outflows        numeric DEFAULT 0,
  closing         numeric DEFAULT 0,
  status          text DEFAULT 'Surplus' CHECK (status IN ('Surplus', 'Watch', 'Deficit')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_liquidity_forecasts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_liquidity_forecasts TO authenticated;

INSERT INTO public.treasury_liquidity_forecasts (id, week_label, opening, inflows, outflows, closing, status, property_id)
VALUES
  ('tlf_001', 'W1', 1850, 420, 280, 1990, 'Surplus', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tlf_002', 'W2', 1990, 380, 310, 2060, 'Surplus', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tlf_003', 'W3', 2060, 290, 340, 2010, 'Surplus', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tlf_004', 'W4', 2010, 450, 520, 1940, 'Watch',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tlf_005', 'W5', 1940, 310, 290, 1960, 'Surplus', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tlf_006', 'W6', 1960, 280, 350, 1890, 'Watch',   '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── treasury_cash_pool_participants ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_cash_pool_participants (
  id              text PRIMARY KEY,
  account_name    text NOT NULL,
  entity          text,
  balance         numeric DEFAULT 0,
  sweep_amount    numeric DEFAULT 0,
  role            text DEFAULT 'Participant' CHECK (role IN ('Header', 'Participant', 'Reserve')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.treasury_cash_pool_participants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.treasury_cash_pool_participants TO authenticated;

INSERT INTO public.treasury_cash_pool_participants (id, account_name, entity, balance, sweep_amount, role, property_id)
VALUES
  ('tcp_001', 'CBE Operating',    'Hotel Main',   1850000,      0, 'Header',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcp_002', 'CBE F&B',          'F&B Division',  420000, 380000, 'Participant', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcp_003', 'Awash Payroll',    'HR Dept',       450000, 410000, 'Participant', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcp_004', 'CBE Engineering',  'Engineering',   280000, 250000, 'Participant', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('tcp_005', 'Dashen Reserve',   'Treasury',      200000,      0, 'Reserve',     '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
