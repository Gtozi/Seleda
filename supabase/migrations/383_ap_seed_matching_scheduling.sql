-- Migration 383: AP seed data (vendors, bills, payments) + 3-way matching + payment scheduling tables
-- Backs the /erp/finance/ap tab. The existing ap_bills and ap_payments tables have FKs to
-- ap_vendors(id), so we seed ap_vendors. We also mirror into the legacy vendors table so the
-- existing GET /vendors endpoint (which reads from vendors) keeps working until backend is updated.

-- ── Seed ap_vendors (canonical AP vendor table, referenced by ap_bills/ap_payments) ──
INSERT INTO public.ap_vendors (id, vendor_code, name, tin, payment_terms, category, is_withholding_agent, withholding_rate, contact_person, email, phone, address, city, country, is_active, credit_limit, current_balance, property_id)
VALUES
  ('vendor_apex',   'VND-001', 'Apex Cleaning Supplies',        'TIN-100000001', 'Net 30', 'Operations',  true,  2, 'Samuel Tadesse',  'orders@apexclean.com',     '+251 911 100 001', 'Bole Industrial, Addis Ababa', 'Addis Ababa', 'Ethiopia', true, 50000, 5000,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('vendor_food',   'VND-002', 'Food Provisions Ltd',           'TIN-100000002', 'Net 15', 'F&B',         true,  2, 'Hanan Ali',       'sales@foodprov.com',       '+251 911 100 002', 'Mercato, Addis Ababa',         'Addis Ababa', 'Ethiopia', true, 100000, 8500, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('vendor_maint',  'VND-003', 'Maintenance Services',          'TIN-100000003', 'Net 30', 'Maintenance', true,  2, 'Dawit Bekele',    'service@maint.co',         '+251 911 100 003', 'Piazza, Addis Ababa',          'Addis Ababa', 'Ethiopia', true, 30000, 3200,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('vendor_office', 'VND-004', 'Office Supplies Co',            'TIN-100000004', 'Net 30', 'Operations',  true,  2, 'Sara Girma',      'info@officesupplies.com',  '+251 911 100 004', 'Kazanchis, Addis Ababa',       'Addis Ababa', 'Ethiopia', true, 20000, 1200,  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('vendor_tech',   'VND-005', 'Tech Equipment Inc',            'TIN-100000005', 'Net 45', 'Operations',  true,  2, 'Yonas Haile',     'sales@techequip.com',      '+251 911 100 005', 'Sarbet, Addis Ababa',          'Addis Ababa', 'Ethiopia', true, 200000, 15000, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('vendor_util',   'VND-006', 'Ethiopian Electric Utility',    'TIN-100000006', 'Net 30', 'Utilities',   false, 0, 'Billing Dept',    'business@eeu.gov.et',      '+251 911 100 006', 'Arat Kilo, Addis Ababa',       'Addis Ababa', 'Ethiopia', true, 100000, 0,     '1579f5e1-3ddc-41d7-bbb0-60ee00ac5f6b')
ON CONFLICT (id) DO NOTHING;

-- ── Mirror into legacy vendors table (kept in sync until backend is migrated) ──
INSERT INTO public.vendors (id, name, contact_name, email, phone, address, tax_id, withholding_rate, category, status, balance, property_id)
SELECT id, name, contact_person, email, phone, address, tin, COALESCE(withholding_rate, 0), category,
       CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END, COALESCE(current_balance, 0), property_id
FROM public.ap_vendors
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  contact_name = EXCLUDED.contact_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  address = EXCLUDED.address,
  tax_id = EXCLUDED.tax_id,
  withholding_rate = EXCLUDED.withholding_rate,
  category = EXCLUDED.category,
  balance = EXCLUDED.balance,
  property_id = EXCLUDED.property_id;

-- ── Seed ap_bills ────────────────────────────────────────────────────────
INSERT INTO public.ap_bills (id, bill_number, vendor_id, bill_date, due_date, reference, description, status, subtotal, tax_amount, withholding_amount, total_amount, paid_amount, currency, property_id)
VALUES
  ('bill_001', 'BILL-2024-089', 'vendor_apex',   '2024-05-15', '2024-06-15', 'PO-2024-089', 'Cleaning supplies monthly delivery',  'Approved', 4347.83, 652.17, 100, 5000,    0,     'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bill_002', 'BILL-2024-092', 'vendor_food',   '2024-05-20', '2024-06-05', 'PO-2024-092', 'Food provisions weekly delivery',      'Overdue',  7391.30, 1108.70, 200, 8500,    0,     'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bill_003', 'BILL-2024-078', 'vendor_maint',  '2024-05-10', '2024-05-25', 'PO-2024-078', 'HVAC maintenance service',             'Overdue',  2782.61, 417.39,  80,  3200,    0,     'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bill_004', 'BILL-2024-095', 'vendor_office', '2024-06-01', '2024-07-01', 'PO-2024-095', 'Office supplies quarterly order',      'Approved', 1043.48, 156.52,  30,  1200,    0,     'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bill_005', 'BILL-2024-082', 'vendor_tech',   '2024-05-25', '2024-06-25', 'PO-2024-082', 'IT equipment - servers and switches', 'Approved', 13043.48, 1956.52, 300, 15000, 0,     'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bill_006', 'BILL-2024-101', 'vendor_apex',   '2024-05-01', '2024-05-15', 'PO-2024-101', 'Cleaning supplies - prior month',      'Paid',     4347.83, 652.17, 100, 5000,    5000,  'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('bill_007', 'BILL-2024-110', 'vendor_util',   '2024-06-01', '2024-07-01', 'UTIL-2024-06', 'Electricity bill - June 2024',        'Approved', 7826.09, 1173.91, 0,   9000,    0,     'ETB', '1579f5e1-3ddc-41d7-bbb0-60ee00ac5f6b')
ON CONFLICT (id) DO NOTHING;

-- Sync vendor balances from bills
UPDATE vendors SET balance = (
  SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM ap_bills WHERE ap_bills.vendor_id = vendors.id AND ap_bills.status IN ('Approved', 'Overdue')
) WHERE id IN ('vendor_apex', 'vendor_food', 'vendor_maint', 'vendor_office', 'vendor_tech', 'vendor_util');

UPDATE ap_vendors SET current_balance = (
  SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM ap_bills WHERE ap_bills.vendor_id = ap_vendors.id AND ap_bills.status IN ('Approved', 'Overdue')
) WHERE id IN ('vendor_apex', 'vendor_food', 'vendor_maint', 'vendor_office', 'vendor_tech', 'vendor_util');

-- ── Seed ap_payments ─────────────────────────────────────────────────────
INSERT INTO public.ap_payments (id, payment_number, vendor_id, payment_date, payment_method, amount, currency, reference, description, status, bill_id, property_id)
VALUES
  ('pay_001', 'PAY-2024-001', 'vendor_apex', '2024-05-15', 'Bank', 5000,  'ETB', 'BANK-TRF-001', 'Payment for BILL-2024-101', 'Processed', 'bill_006', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pay_002', 'PAY-2024-002', 'vendor_food', '2024-04-20', 'Bank', 12000, 'ETB', 'BANK-TRF-002', 'Food provisions - April',    'Processed', NULL,       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('pay_003', 'PAY-2024-003', 'vendor_maint','2024-04-15', 'Check',2800,  'ETB', 'CHK-001',      'Maintenance - April',        'Processed', NULL,       '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── ap_three_way_matches table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ap_three_way_matches (
  id              text PRIMARY KEY,
  po_number       text,
  vendor_id       text REFERENCES public.ap_vendors(id) ON DELETE SET NULL,
  bill_id         text REFERENCES public.ap_bills(id) ON DELETE SET NULL,
  invoice_match   text DEFAULT 'Pending' CHECK (invoice_match IN ('Matched', 'Pending', 'Mismatch')),
  receipt_match   text DEFAULT 'Pending' CHECK (receipt_match IN ('Matched', 'Pending', 'Mismatch')),
  po_amount       numeric DEFAULT 0,
  invoice_amount  numeric DEFAULT 0,
  variance_pct    numeric DEFAULT 0,
  status          text DEFAULT 'Pending' CHECK (status IN ('Approved', 'Pending', 'Discrepancy')),
  approved_by     text,
  approved_at     timestamptz,
  notes           text,
  property_id     uuid,
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.ap_three_way_matches ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_three_way_matches TO authenticated;

INSERT INTO public.ap_three_way_matches (id, po_number, vendor_id, bill_id, invoice_match, receipt_match, po_amount, invoice_amount, variance_pct, status, property_id)
VALUES
  ('twm_001', 'PO-2024-089', 'vendor_apex',   'bill_001', 'Matched', 'Matched', 5000,  5000,  0,     'Approved',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('twm_002', 'PO-2024-092', 'vendor_food',   'bill_002', 'Matched', 'Pending', 8500,  8500,  0,     'Pending',    '18762279-a389-41c9-9169-7ebc682e9703'),
  ('twm_003', 'PO-2024-078', 'vendor_maint',  'bill_003', 'Pending', 'Matched', 3200,  3500,  9.38,  'Discrepancy','18762279-a389-41c9-9169-7ebc682e9703'),
  ('twm_004', 'PO-2024-095', 'vendor_office', 'bill_004', 'Matched', 'Matched', 1200,  1200,  0,     'Approved',   '18762279-a389-41c9-9169-7ebc682e9703'),
  ('twm_005', 'PO-2024-082', 'vendor_tech',   'bill_005', 'Matched', 'Pending', 15000, 15000, 0,     'Pending',    '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── ap_payment_schedules table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ap_payment_schedules (
  id              text PRIMARY KEY,
  vendor_id       text REFERENCES public.ap_vendors(id) ON DELETE SET NULL,
  bill_id         text REFERENCES public.ap_bills(id) ON DELETE SET NULL,
  bill_number     text,
  scheduled_date  date,
  amount          numeric DEFAULT 0,
  payment_method  text DEFAULT 'Bank',
  frequency       text DEFAULT 'One-time' CHECK (frequency IN ('One-time', 'Weekly', 'Monthly', 'Quarterly')),
  auto_pay        boolean DEFAULT false,
  status          text DEFAULT 'Pending' CHECK (status IN ('Pending', 'Processed', 'Overdue', 'Cancelled')),
  notes           text,
  property_id     uuid,
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.ap_payment_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_payment_schedules TO authenticated;

INSERT INTO public.ap_payment_schedules (id, vendor_id, bill_id, bill_number, scheduled_date, amount, payment_method, frequency, auto_pay, status, property_id)
VALUES
  ('aps_001', 'vendor_apex',   'bill_001', 'BILL-2024-089', '2024-06-10', 5000,  'Bank', 'Monthly',   true,  'Pending',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('aps_002', 'vendor_food',   'bill_002', 'BILL-2024-092', '2024-06-12', 8500,  'Bank', 'Weekly',    true,  'Pending',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('aps_003', 'vendor_maint',  'bill_003', 'BILL-2024-078', '2024-06-08', 3200,  'Check','One-time',  false, 'Overdue',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('aps_004', 'vendor_office', 'bill_004', 'BILL-2024-095', '2024-06-15', 1200,  'Bank', 'Monthly',   true,  'Pending',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('aps_005', 'vendor_tech',   'bill_005', 'BILL-2024-082', '2024-06-20', 15000, 'Bank', 'Quarterly', false, 'Pending',  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
