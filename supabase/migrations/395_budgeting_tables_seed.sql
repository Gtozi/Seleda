-- Migration 395: Budgeting tables seed + budget_transfers/forecasts/types
-- Backs the /erp/finance/budgeting tab. Seeds the existing `budgets` table
-- and creates new `budget_transfers`, `budget_forecasts`, `budget_types` tables.
-- Replaces mock/placeholder data in BudgetAnalysis.tsx.

-- ── Alter budgets version check to allow Pending Approval and Rejected ─────
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_version_check;
ALTER TABLE public.budgets ADD CONSTRAINT budgets_version_check
  CHECK (version IN ('Draft','Pending Approval','Approved','Rejected'));

-- ── Seed budgets table (already exists with property_id FK) ────────────────
-- Uses valid account_code values from usali_chart_of_accounts.
-- approved_by/created_by left NULL (FK to system_users).
INSERT INTO public.budgets (id, budget_name, period, account_code, department, budgeted_amount, actual_amount, variance, variance_percent, version, approved_by, created_by, property_id)
VALUES
  ('bg_001', 'Q3 Front Office Revenue',    '2024-Q3', '4060', 'Front Office',     480000, 462000, -18000, -3.75,  'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_002', 'Q3 Kitchen Operations',      '2024-Q3', '6100', 'F&B',              280000, 265000, -15000, -5.36,  'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_003', 'Q3 Housekeeping Labor',      '2024-Q3', '5100', 'Housekeeping',      95000,  88000,  -7000, -7.37, 'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_004', 'Q3 Engineering Maintenance', '2024-Q3', '5300', 'Engineering',       75000,  82000,   7000,  9.33, 'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_005', 'Q3 Sales & Marketing',       '2024-Q3', '5400', 'Sales',             65000,  58000,  -7000,-10.77, 'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_006', 'Q3 Spa & Wellness',          '2024-Q3', '4080', 'Spa',               45000,  38000,  -7000,-15.56, 'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_007', 'Q3 IT Infrastructure',       '2024-Q3', '5200', 'IT',                55000,  52000,  -3000, -5.45, 'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_008', 'Q3 HR & Training',           '2024-Q3', '3500', 'HR',                48000,  45000,  -3000, -6.25, 'Approved',         NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_009', 'Q4 Marketing Campaign',      '2024-Q4', '5400', 'Sales',             85000,      0,      0,  0.00, 'Draft',            NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_010', 'Q4 IT Infrastructure Upgrade','2024-Q4','5200', 'IT',               120000,      0,      0,  0.00, 'Pending Approval', NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_011', 'Q4 Staff Training Program',  '2024-Q4', '3500', 'HR',                35000,      0,      0,  0.00, 'Pending Approval', NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bg_012', 'Q4 Capital Renovations',     '2024-Q4', '5300', 'Engineering',       95000,      0,      0,  0.00, 'Draft',            NULL, NULL, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── budget_types ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_types (
  id          text PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  entry_count integer DEFAULT 0,
  status      text DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.budget_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_types TO authenticated;

INSERT INTO public.budget_types (id, code, name, description, entry_count, status, property_id)
VALUES
  ('bt_001', 'OP',   'Operating Budget',    'Day-to-day operational expenses and revenue', 24, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_002', 'CAP',  'Capital Budget',      'Major purchases, renovations, and capital projects', 8, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_003', 'CASH', 'Cash Budget',         'Projected cash inflows and outflows', 12, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_004', 'FLEX', 'Flexible Budget',     'Adjusts based on activity volume', 6, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_005', 'ZBB',  'Zero-Based Budget',   'All expenses must be justified each period', 4, 'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── budget_forecasts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_forecasts (
  id              text PRIMARY KEY,
  department      text NOT NULL,
  q3_forecast     numeric DEFAULT 0,
  q4_forecast     numeric DEFAULT 0,
  fy_total        numeric DEFAULT 0,
  trend           text DEFAULT 'Stable' CHECK (trend IN ('Up','Stable','Down')),
  confidence      numeric DEFAULT 0,
  period          text DEFAULT '2024',
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.budget_forecasts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_forecasts TO authenticated;

INSERT INTO public.budget_forecasts (id, department, q3_forecast, q4_forecast, fy_total, trend, confidence, period, property_id)
VALUES
  ('bf_001', 'Front Office',    580000, 650000, 1230000, 'Up',      92, '2024', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bf_002', 'F&B',             420000, 480000,  900000, 'Up',      88, '2024', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bf_003', 'Housekeeping',    180000, 195000,  375000, 'Stable',  85, '2024', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bf_004', 'Engineering',     220000, 240000,  460000, 'Up',      82, '2024', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bf_005', 'Administration',  280000, 290000,  570000, 'Stable',  90, '2024', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── budget_transfers ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_transfers (
  id              text PRIMARY KEY,
  transfer_number text NOT NULL,
  from_department text NOT NULL,
  to_department   text NOT NULL,
  amount          numeric DEFAULT 0,
  transfer_date   date,
  reason          text,
  status          text DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by     text,
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.budget_transfers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_transfers TO authenticated;

INSERT INTO public.budget_transfers (id, transfer_number, from_department, to_department, amount, transfer_date, reason, status, approved_by, property_id)
VALUES
  ('bt_001', 'BT-001', 'Marketing',      'Front Office',  15000, '2024-06-01', 'Reallocation for front desk upgrade',         'Approved', NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_002', 'BT-002', 'Administration', 'Engineering',   25000, '2024-05-20', 'Emergency maintenance work',                  'Approved', NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_003', 'BT-003', 'Housekeeping',   'F&B',            8000, '2024-06-05', 'Additional F&B supplies for event',           'Pending',  NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_004', 'BT-004', 'Front Office',   'Engineering',   12000, '2024-05-15', 'HVAC repair reallocation',                     'Approved', NULL, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bt_005', 'BT-005', 'IT',             'HR',             5000, '2024-06-10', 'Training software licenses',                   'Pending',  NULL, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
