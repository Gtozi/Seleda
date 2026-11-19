-- Migration 393: Expense Management tables + seed data
-- Backs the /erp/finance/expense tab. The expense_requests table already exists
-- (migration 114) with property_id FK. This migration:
--   1. Seeds expense_requests with realistic data
--   2. Creates expense_claims, expense_approval_workflows, recurring_expenses tables

-- ── Seed expense_requests (table already exists) ───────────────────────────
INSERT INTO public.expense_requests (id, request_date, department, category, subcategory, description, amount, status, requested_by, approver, attachments, priority, is_grn, supplier_name, property_id)
VALUES
  ('exp_001', '2024-06-30', 'F&B',          'food_cost',     'Meat & Poultry',  'Weekly meat supply - Prime Butcher',     28500, 'Approved',    'Chef Marcus',   'Finance Mgr', 2, 'High',   false, 'Prime Butcher Ltd',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_002', '2024-06-30', 'F&B',          'beverage_cost', 'Wine & Spirits',  'Monthly wine restock - Dashen distributor', 42000, 'Paid',        'Chef Marcus',   'Finance Mgr', 1, 'Medium', false, 'Dashen Distributors',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_003', '2024-06-29', 'Engineering',  'maintenance',   'HVAC',            'HVAC quarterly service contract',         8500, 'Approved',    'Eng. Team',     'Finance Mgr', 0, 'Medium', false, 'CoolTech Services',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_004', '2024-06-29', 'Housekeeping', 'supplies',      'Cleaning',        'Cleaning supplies monthly stock',         12500, 'Under Review','HK Manager',    NULL,          3, 'Low',    false, 'CleanPro Supplies',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_005', '2024-06-28', 'Front Office', 'utilities',     'Internet',        'Monthly internet and phone services',     8500, 'Paid',        'FO Manager',    'Finance Mgr', 0, 'Low',    false, 'Ethio Telecom',         '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_006', '2024-06-28', 'Sales',        'marketing',     'Digital Ads',     'Social media advertising campaign',       15000, 'Under Review','Sales Dir',     NULL,          1, 'Medium', false, 'Meta Platforms',        '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_007', '2024-06-27', 'HR',           'payroll',       'Overtime',        'June overtime payroll adjustment',        32000, 'Approved',    'HR Manager',    'Finance Mgr', 0, 'High',   false, NULL,                    '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_008', '2024-06-27', 'Engineering',  'maintenance',   'Electrical',      'Emergency electrical repair - Kitchen',   4500, 'Paid',        'Eng. Team',     'Finance Mgr', 2, 'High',   false, 'PowerFix Electric',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_009', '2024-06-26', 'F&B',          'food_cost',     'Vegetables',      'Organic vegetable supply - weekly',        8500, 'Rejected',    'Chef Marcus',   'Finance Mgr', 1, 'Low',    false, 'Green Farms Co-op',     '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_010', '2024-06-26', 'Housekeeping', 'laundry_cost',  'Linen',           'Linen cleaning service - June',           18000, 'Paid',        'HK Manager',    'Finance Mgr', 0, 'Medium', false, 'Sparkle Laundry',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_011', '2024-06-25', 'Finance',      'insurance',     'Property',        'Monthly property insurance premium',      22000, 'Paid',        'Finance Mgr',   'GM',          0, 'High',   false, 'Nyala Insurance',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('exp_012', '2024-06-25', 'F&B',          'beverage_cost', 'Coffee',          'Specialty coffee beans - monthly',         6500, 'Approved',    'Bar Manager',   'Finance Mgr', 1, 'Low',    false, 'Ethio Coffee Roasters', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── expense_claims ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_claims (
  id              text PRIMARY KEY,
  employee_id     text,
  employee_name   text NOT NULL,
  amount          numeric DEFAULT 0,
  category        text,
  description     text,
  status          text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  submitted_date  date,
  approved_date   date,
  approved_by     text,
  receipts_count  integer DEFAULT 0,
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_claims TO authenticated;

INSERT INTO public.expense_claims (id, employee_id, employee_name, amount, category, description, status, submitted_date, approved_date, approved_by, receipts_count, property_id)
VALUES
  ('ecl_001', 'emp_001', 'Sarah Bekele',    1250, 'travel',        'Client meeting transport - Addis Ababa',     'pending',  '2024-06-28', NULL,         NULL,           2, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ecl_002', 'emp_002', 'Dawit Tadesse',    850, 'meals',         'Team lunch with vendor',                     'approved', '2024-06-27', '2024-06-28', 'Finance Mgr',  1, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ecl_003', 'emp_003', 'Hanan Ahmed',     2100, 'supplies',      'Office supplies - printer ink and paper',     'paid',     '2024-06-20', '2024-06-22', 'Finance Mgr',  3, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ecl_004', 'emp_004', 'Yonas Girma',      450, 'parking',       'Guest parking reimbursement',                 'rejected', '2024-06-25', NULL,         NULL,           0, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ecl_005', 'emp_001', 'Sarah Bekele',    1800, 'travel',        'Airport pickup - VIP client',                 'approved', '2024-06-26', '2024-06-27', 'GM',           2, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ecl_006', 'emp_005', 'Meron Solomon',    650, 'training',      'Online hospitality certification course',     'pending',  '2024-06-29', NULL,         NULL,           1, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── expense_approval_workflows ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_approval_workflows (
  id              text PRIMARY KEY,
  workflow_name   text NOT NULL,
  category        text,
  min_amount      numeric DEFAULT 0,
  max_amount      numeric DEFAULT 999999999,
  approver_level1 text,
  approver_level2 text,
  auto_approve_below numeric DEFAULT 0,
  status          text DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.expense_approval_workflows ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_approval_workflows TO authenticated;

INSERT INTO public.expense_approval_workflows (id, workflow_name, category, min_amount, max_amount, approver_level1, approver_level2, auto_approve_below, status, property_id)
VALUES
  ('eaw_001', 'Standard Expense Approval',   NULL,         0,    10000, 'Department Manager', 'Finance Manager',     0,     'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('eaw_002', 'High-Value Expense Approval', NULL,     10000,   100000, 'Department Manager', 'General Manager',     0,     'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('eaw_003', 'Capital Expenditure Approval', 'capital', 100000, 999999999, 'General Manager', 'Board Approval',      0,     'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('eaw_004', 'Auto-Approve Minor Expenses',  'supplies',     0,     500, 'Auto-Approved',      NULL,                  500,   'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── recurring_expenses ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id              text PRIMARY KEY,
  description     text NOT NULL,
  category        text,
  amount          numeric DEFAULT 0,
  frequency       text DEFAULT 'Monthly' CHECK (frequency IN ('Daily','Weekly','Monthly','Quarterly','Annual')),
  next_date       date,
  vendor          text,
  department      text,
  status          text DEFAULT 'Active' CHECK (status IN ('Active','Paused','Cancelled')),
  property_id     uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_expenses TO authenticated;

INSERT INTO public.recurring_expenses (id, description, category, amount, frequency, next_date, vendor, department, status, property_id)
VALUES
  ('rex_001', 'Property insurance premium',      'insurance',     22000, 'Monthly',   '2024-07-25', 'Nyala Insurance',       'Finance',      'Active',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rex_002', 'Internet & phone services',       'utilities',      8500, 'Monthly',   '2024-07-28', 'Ethio Telecom',         'Front Office', 'Active',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rex_003', 'HVAC service contract',           'maintenance',    8500, 'Quarterly', '2024-09-29', 'CoolTech Services',     'Engineering',  'Active',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rex_004', 'Linen cleaning service',          'laundry_cost',  18000, 'Monthly',   '2024-07-26', 'Sparkle Laundry',       'Housekeeping', 'Active',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rex_005', 'Annual software licenses',        'supplies',      45000, 'Annual',    '2025-01-15', 'Microsoft',             'IT',           'Active',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rex_006', 'Security guard service',          'other',         35000, 'Monthly',   '2024-07-01', 'SecureGuard Ltd',       'Operations',   'Active',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('rex_007', 'Pest control service',            'maintenance',    3500, 'Quarterly', '2024-09-15', 'PestFree Services',     'Housekeeping', 'Paused',  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
