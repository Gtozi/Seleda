-- Migration 385: Chart of Accounts property scoping and seed expansion
-- Adds property_id to usali_chart_of_accounts and seeds realistic balances
-- for the /erp/finance/coa module.

ALTER TABLE public.usali_chart_of_accounts ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;

-- Update existing demo accounts with realistic balances and property
UPDATE usali_chart_of_accounts SET property_id = '18762279-a389-41c9-9169-7ebc682e9703', balance = 485000.00 WHERE code = '1010';
UPDATE usali_chart_of_accounts SET subcategory = 'Cash' WHERE code = '1010' AND subcategory IS NULL;

-- Add missing Liability accounts
INSERT INTO public.usali_chart_of_accounts (id, code, name, category, subcategory, department, account_type, is_active, parent_code, description, normal_balance, currency, is_control_account, balance, property_id)
VALUES
  ('a1b2c3d4-0001-4000-8000-000000000001', '2000', 'Accounts Payable',           'Liability', 'Current Liabilities', 'Finance',     'Liability', true, NULL, 'Trade payables to vendors',           'Credit', 'ETB', true,  38500.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('a1b2c3d4-0001-4000-8000-000000000002', '2100', 'Accrued Expenses',             'Liability', 'Current Liabilities', 'Finance',     'Liability', true, NULL, 'Accrued operating expenses',         'Credit', 'ETB', false, 12500.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('a1b2c3d4-0001-4000-8000-000000000003', '2200', 'Tax Payable - VAT',            'Liability', 'Current Liabilities', 'Finance',     'Liability', true, NULL, 'VAT collected from guests',          'Credit', 'ETB', true,  18750.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('a1b2c3d4-0001-4000-8000-000000000004', '2300', 'Service Charge Payable',       'Liability', 'Current Liabilities', 'Finance',     'Liability', true, NULL, '10% service charge collected',       'Credit', 'ETB', false, 8200.00,   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('a1b2c3d4-0001-4000-8000-000000000005', '2400', 'Environmental Tax Payable',    'Liability', 'Current Liabilities', 'Finance',     'Liability', true, NULL, 'Environmental tourism tax',          'Credit', 'ETB', false, 3200.00,   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('a1b2c3d4-0001-4000-8000-000000000006', '2500', 'Payroll Liabilities',          'Liability', 'Current Liabilities', 'HR',          'Liability', true, NULL, 'Salaries and wages payable',         'Credit', 'ETB', false, 95000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('a1b2c3d4-0001-4000-8000-000000000007', '2600', 'Long-Term Debt',               'Liability', 'Long-Term Liabilities','Finance',    'Liability', true, NULL, 'Bank loans and mortgages',           'Credit', 'ETB', false, 2500000.00,'18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- Add Equity accounts
INSERT INTO public.usali_chart_of_accounts (id, code, name, category, subcategory, department, account_type, is_active, parent_code, description, normal_balance, currency, is_control_account, balance, property_id)
VALUES
  ('b1c2d3e4-0001-4000-8000-000000000001', '3900', 'Owner Equity',                 'Equity', 'Capital',         'Finance', 'Equity', true, NULL, 'Owner capital contributions',        'Credit', 'ETB', false, 2000000.00, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('b1c2d3e4-0001-4000-8000-000000000002', '3910', 'Retained Earnings',            'Equity', 'Retained Earnings','Finance', 'Equity', true, NULL, 'Accumulated retained earnings',      'Credit', 'ETB', false, 850000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('b1c2d3e4-0001-4000-8000-000000000003', '3920', 'Current Year Earnings',        'Equity', 'Retained Earnings','Finance', 'Equity', true, NULL, 'Net income for current year',        'Credit', 'ETB', false, 175000.00,  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- Update Revenue account balances
UPDATE usali_chart_of_accounts SET balance = 1250000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '4010';
UPDATE usali_chart_of_accounts SET balance = 485000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '4020';
UPDATE usali_chart_of_accounts SET balance = 32000.00,   property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '4030';
UPDATE usali_chart_of_accounts SET balance = 8500.00,    property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '4040';

-- Update Expense account balances (code 3100-3500 range)
UPDATE usali_chart_of_accounts SET balance = 380000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '3100' AND name = 'Cost of Food Sales';
UPDATE usali_chart_of_accounts SET balance = 145000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '3200' AND category = 'Expense';
UPDATE usali_chart_of_accounts SET balance = 68000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '3300';
UPDATE usali_chart_of_accounts SET balance = 42000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '3400';
UPDATE usali_chart_of_accounts SET balance = 15000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '3500';
UPDATE usali_chart_of_accounts SET balance = 225000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '5010';

-- Update Asset account balances
UPDATE usali_chart_of_accounts SET balance = 125000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1020';
UPDATE usali_chart_of_accounts SET balance = 86000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1100' AND name = 'Accounts Receivable';
UPDATE usali_chart_of_accounts SET balance = 125000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1110' AND name = 'Inventory - Beverage';
UPDATE usali_chart_of_accounts SET balance = 45000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1120' AND name = 'Inventory - Housekeeping Supplies';
UPDATE usali_chart_of_accounts SET balance = 28000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1130' AND name = 'Inventory - Engineering Supplies';
UPDATE usali_chart_of_accounts SET balance = 38000.00,  property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1150' AND name = 'Inventory - Linen';
UPDATE usali_chart_of_accounts SET balance = 185000.00, property_id = '18762279-a389-41c9-9169-7ebc682e9703' WHERE code = '1190' AND name = 'Inventory - Central Warehouse';

-- Add subcategories to existing accounts where missing
UPDATE usali_chart_of_accounts SET subcategory = 'Cash' WHERE subcategory IS NULL AND category = 'Asset' AND (name ILIKE '%cash%' OR name ILIKE '%bank%');
UPDATE usali_chart_of_accounts SET subcategory = 'Receivable' WHERE subcategory IS NULL AND category = 'Asset' AND name ILIKE '%receivable%';
UPDATE usali_chart_of_accounts SET subcategory = 'Inventory' WHERE subcategory IS NULL AND category = 'Asset' AND name ILIKE '%inventory%';
UPDATE usali_chart_of_accounts SET subcategory = 'Revenue' WHERE subcategory IS NULL AND category = 'Revenue';
UPDATE usali_chart_of_accounts SET subcategory = 'Cost of Sales' WHERE subcategory IS NULL AND category = 'Expense' AND name ILIKE '%cost%';
UPDATE usali_chart_of_accounts SET subcategory = 'Operating Expense' WHERE subcategory IS NULL AND category = 'Expense' AND name ILIKE '%shrinkage%';
UPDATE usali_chart_of_accounts SET subcategory = 'Operating Expense' WHERE subcategory IS NULL AND category = 'Expense' AND name ILIKE '%variance%';

-- Add additional revenue and expense accounts
INSERT INTO public.usali_chart_of_accounts (id, code, name, category, subcategory, department, account_type, is_active, parent_code, description, normal_balance, currency, is_control_account, balance, property_id)
VALUES
  ('c1d2e3f4-0001-4000-8000-000000000001', '4050', 'Banquet Revenue',             'Revenue', 'Revenue', 'F&B',         'Revenue', true, NULL, 'Banquet and event revenue',          'Credit', 'ETB', false, 95000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000002', '4060', 'Conference Room Revenue',     'Revenue', 'Revenue', 'Front Office','Revenue', true, NULL, 'Meeting room rentals',               'Credit', 'ETB', false, 38000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000003', '4070', 'Laundry Revenue',             'Revenue', 'Revenue', 'Housekeeping','Revenue', true, NULL, 'Guest laundry services',             'Credit', 'ETB', false, 12500.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000004', '4080', 'Spa Revenue',                 'Revenue', 'Revenue', 'Spa',         'Revenue', true, NULL, 'Spa and wellness services',          'Credit', 'ETB', false, 22000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000005', '5100', 'Salaries and Wages',          'Expense', 'Operating Expense','HR',     'Expense', true, NULL, 'Staff salaries and wages',           'Debit',  'ETB', false, 320000.00, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000006', '5200', 'Utilities',                   'Expense', 'Operating Expense','Engineering','Expense', true, NULL, 'Electricity, water, gas',         'Debit',  'ETB', false, 85000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000007', '5300', 'Repairs and Maintenance',     'Expense', 'Operating Expense','Engineering','Expense', true, NULL, 'Building and equipment repairs',  'Debit',  'ETB', false, 42000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000008', '5400', 'Marketing and Advertising',   'Expense', 'Operating Expense','Sales', 'Expense', true, NULL, 'Promotional and advertising costs',  'Debit',  'ETB', false, 28000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000009', '5500', 'Insurance',                   'Expense', 'Operating Expense','Finance','Expense', true, NULL, 'Property and liability insurance',   'Debit',  'ETB', false, 18000.00,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('c1d2e3f4-0001-4000-8000-000000000010', '5600', 'Depreciation',                'Expense', 'Operating Expense','Finance','Expense', true, NULL, 'Building and equipment depreciation','Debit',  'ETB', false, 65000.00,  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
