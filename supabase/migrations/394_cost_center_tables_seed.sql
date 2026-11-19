-- Migration 394: Cost Center Accounting tables + seed data
-- Backs the /erp/finance/cost_center tab. Replaces the mock/placeholder data in
-- CostCenterAccounting.tsx with persistent, DB-backed records.
-- Tables: cost_centers, department_profit_loss, profit_centers, profitability_analysis

-- ── cost_centers ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id              text PRIMARY KEY,
  code            text NOT NULL,
  name            text NOT NULL,
  department      text,
  manager         text,
  budget          numeric DEFAULT 0,
  actual_expense  numeric DEFAULT 0,
  actual_revenue  numeric DEFAULT 0,
  variance        numeric DEFAULT 0,
  status          text DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_centers TO authenticated;

INSERT INTO public.cost_centers (id, code, name, department, manager, budget, actual_expense, actual_revenue, variance, status, property_id)
VALUES
  ('cc_001', 'CC-100', 'Front Office Operations',    'Front Office',  'Sarah Bekele',   120000, 105000, 480000,  255000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_002', 'CC-200', 'Kitchen Operations',         'F&B',           'Chef Marcus',    280000, 265000, 520000,  205000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_003', 'CC-210', 'Bar Operations',             'F&B',           'Bar Manager',     85000,  78000, 180000,   17000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_004', 'CC-300', 'Housekeeping',               'Housekeeping',  'HK Manager',      95000,  88000,  45000,  -48000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_005', 'CC-400', 'Engineering & Maintenance',  'Engineering',   'Eng. Director',   75000,  82000,      0,  -82000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_006', 'CC-500', 'Sales & Marketing',          'Sales',         'Sales Director',  65000,  58000,  85000,   22000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_007', 'CC-600', 'Spa & Wellness',             'Spa',           'Spa Manager',     45000,  38000,  92000,   54000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_008', 'CC-700', 'IT & Communications',        'IT',            'IT Manager',      55000,  52000,      0,  -52000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_009', 'CC-800', 'Human Resources',            'HR',            'HR Manager',      48000,  45000,      0,  -45000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('cc_010', 'CC-900', 'Gift Shop',                  'Retail',        'Shop Manager',    25000,  22000,  68000,   46000, 'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── department_profit_loss ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.department_profit_loss (
  id                  text PRIMARY KEY,
  department          text NOT NULL,
  revenue             numeric DEFAULT 0,
  cost_of_sales       numeric DEFAULT 0,
  gross_profit        numeric DEFAULT 0,
  operating_expenses  numeric DEFAULT 0,
  operating_profit    numeric DEFAULT 0,
  net_profit          numeric DEFAULT 0,
  period              text DEFAULT '2024-06',
  property_id         uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.department_profit_loss ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_profit_loss TO authenticated;

INSERT INTO public.department_profit_loss (id, department, revenue, cost_of_sales, gross_profit, operating_expenses, operating_profit, net_profit, period, property_id)
VALUES
  ('dpl_001', 'Front Office',  480000,  50000, 430000, 105000, 325000, 260000, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dpl_002', 'F&B',           700000, 280000, 420000, 156000, 264000, 211200, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dpl_003', 'Housekeeping',   45000,  15000,  30000,  88000, -58000, -46400, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dpl_004', 'Engineering',         0,      0,      0,  82000, -82000, -65600, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dpl_005', 'Sales',          85000,   5000,  80000,  58000,  22000,  17600, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dpl_006', 'Spa',            92000,  12000,  80000,  38000,  42000,  33600, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('dpl_007', 'Retail',         68000,  18000,  50000,  22000,  28000,  22400, '2024-06', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── profit_centers ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profit_centers (
  id              text PRIMARY KEY,
  code            text NOT NULL,
  name            text NOT NULL,
  department      text,
  revenue         numeric DEFAULT 0,
  direct_costs    numeric DEFAULT 0,
  allocated_costs numeric DEFAULT 0,
  net_profit      numeric DEFAULT 0,
  margin_pct      numeric DEFAULT 0,
  status          text DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.profit_centers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profit_centers TO authenticated;

INSERT INTO public.profit_centers (id, code, name, department, revenue, direct_costs, allocated_costs, net_profit, margin_pct, status, property_id)
VALUES
  ('pc_001', 'PC-100', 'Rooms Division',         'Front Office',  480000,  50000, 105000, 325000, 67.7, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pc_002', 'PC-200', 'Restaurant',             'F&B',           420000, 180000,  78000, 162000, 38.6, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pc_003', 'PC-210', 'Bar & Lounge',           'F&B',           180000,  65000,  22000,  93000, 51.7, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pc_004', 'PC-220', 'Banquet & Events',       'F&B',           100000,  35000,  28000,  37000, 37.0, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pc_005', 'PC-300', 'Spa & Wellness',         'Spa',            92000,  12000,  38000,  42000, 45.7, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pc_006', 'PC-400', 'Gift Shop',              'Retail',         68000,  18000,  22000,  28000, 41.2, 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pc_007', 'PC-500', 'Laundry Service',        'Housekeeping',   45000,  15000,  18000,  12000, 26.7, 'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── profitability_analysis ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profitability_analysis (
  id              text PRIMARY KEY,
  department      text NOT NULL,
  revenue         numeric DEFAULT 0,
  total_costs     numeric DEFAULT 0,
  net_profit      numeric DEFAULT 0,
  margin_pct      numeric DEFAULT 0,
  revenue_share   numeric DEFAULT 0,
  cost_share      numeric DEFAULT 0,
  rating          text DEFAULT 'Good' CHECK (rating IN ('Excellent','Good','Fair','Poor','Loss')),
  period          text DEFAULT '2024-06',
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.profitability_analysis ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profitability_analysis TO authenticated;

INSERT INTO public.profitability_analysis (id, department, revenue, total_costs, net_profit, margin_pct, revenue_share, cost_share, rating, period, property_id)
VALUES
  ('pa_001', 'Front Office',  480000, 155000, 325000, 67.7, 32.9, 26.7, 'Excellent', '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pa_002', 'F&B',           700000, 295000, 264000, 37.7, 48.0, 50.8, 'Good',      '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pa_003', 'Spa',            92000,  50000,  42000, 45.7,  6.3,  8.6, 'Good',      '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pa_004', 'Retail',         68000,  40000,  28000, 41.2,  4.7,  6.9, 'Good',      '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pa_005', 'Sales',          85000,  63000,  22000, 25.9,  5.8, 10.9, 'Fair',      '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pa_006', 'Housekeeping',   45000, 103000, -58000,-128.9,  3.1, 17.8, 'Loss',      '2024-06', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pa_007', 'Engineering',         0,  82000, -82000,  0.0,  0.0, 14.1, 'Loss',      '2024-06', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
