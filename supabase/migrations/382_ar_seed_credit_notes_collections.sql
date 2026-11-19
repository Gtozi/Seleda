-- Migration 382: AR seed data + credit/debit notes + collections tables
-- Backs the /erp/finance/ar tab. ar_customers and ar_invoices already exist
-- but are empty; this seeds them and adds two new tables for credit/debit
-- notes and collections activities.

-- ── Seed ar_customers ────────────────────────────────────────────────────
INSERT INTO public.ar_customers (id, customer_code, customer_type, name, tin, email, phone, address, city, country, credit_limit, current_balance, payment_terms, is_active, property_id)
VALUES
  ('ar_cust_techcorp',  'CUST-001', 'Corporate',   'TechCorp Group',       'TIN-000000001', 'finance@techcorp.com',   '+251 911 111 111', 'Bole Subcity, Addis Ababa',  'Addis Ababa', 'Ethiopia', 500000, 8500,  'Net 30',  true, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cust_abc',       'CUST-002', 'Corporate',   'ABC Corporation',      'TIN-000000002', 'ap@abccorp.com',         '+251 911 222 222', 'Kazanchis, Addis Ababa',     'Addis Ababa', 'Ethiopia', 250000, 4200,  'Net 15',  true, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cust_xyz',       'CUST-003', 'TravelAgent', 'XYZ Travel',           'TIN-000000003', 'billing@xyztravel.com',  '+251 911 333 333', 'Piazza, Addis Ababa',        'Addis Ababa', 'Ethiopia', 750000, 12500, 'Net 45',  true, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cust_govt',      'CUST-004', 'Corporate',   'Ministry of Tourism',  'TIN-000000004', 'procurement@mot.gov.et', '+251 911 444 444', 'Arat Kilo, Addis Ababa',     'Addis Ababa', 'Ethiopia', 1000000, 0,    'Net 60',  true, '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cust_tour',      'CUST-005', 'CityLedger',  'Ethiopia Tours Ltd',   'TIN-000000005', 'accounts@ethtours.com',  '+251 911 555 555', 'Megenagna, Addis Ababa',     'Addis Ababa', 'Ethiopia', 300000, 6700,  'Net 30',  true, '1579f5e1-3ddc-41d7-bbb0-60ee00ac5f6b'),
  ('ar_cust_corp',      'CUST-006', 'Corporate',   'Corporate Client',     'TIN-000000006', 'finance@corpclient.com', '+251 911 666 666', 'Sarbet, Addis Ababa',        'Addis Ababa', 'Ethiopia', 200000, 1800,  'Net 30',  true, '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── Seed ar_invoices ────────────────────────────────────────────────────
INSERT INTO public.ar_invoices (id, invoice_number, customer_id, invoice_date, due_date, description, status, subtotal, tax_amount, total_amount, paid_amount, currency, property_id)
VALUES
  ('ar_inv_001', 'INV-2024-001', 'ar_cust_techcorp', '2024-05-01', '2024-05-31', 'Corporate retreat - May 2024',        'Posted',    25000, 2500, 27500, 19000, 'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_inv_002', 'INV-2024-002', 'ar_cust_abc',      '2024-05-15', '2024-05-30', 'Conference room booking - May 2024',  'Posted',    12000, 1200, 13200, 9000,  'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_inv_003', 'INV-2024-003', 'ar_cust_xyz',      '2024-04-01', '2024-05-15', 'Group booking - 20 rooms - April',    'Overdue',   45000, 4500, 49500, 37000, 'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_inv_004', 'INV-2024-004', 'ar_cust_govt',     '2024-06-01', '2024-07-31', 'Official delegation stay - June',     'Posted',    60000, 6000, 66000, 0,     'ETB', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_inv_005', 'INV-2024-005', 'ar_cust_tour',     '2024-06-10', '2024-07-10', 'Tour group accommodation - June',     'Posted',    18000, 1800, 19800, 13100, 'ETB', '1579f5e1-3ddc-41d7-bbb0-60ee00ac5f6b'),
  ('ar_inv_006', 'INV-2024-006', 'ar_cust_corp',     '2024-06-15', '2024-07-15', 'Executive suite - June 2024',         'Posted',     5000,  500,  5500, 3700,  'ETB', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── ar_credit_notes table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_credit_notes (
  id            text PRIMARY KEY,
  note_number   text NOT NULL,
  note_type     text NOT NULL CHECK (note_type IN ('Credit', 'Debit')),
  customer_id   text REFERENCES public.ar_customers(id) ON DELETE SET NULL,
  invoice_id    text REFERENCES public.ar_invoices(id) ON DELETE SET NULL,
  reason        text,
  amount        numeric DEFAULT 0,
  status        text DEFAULT 'Pending' CHECK (status IN ('Pending', 'Applied', 'Void')),
  applied_at    timestamptz,
  created_by    text,
  property_id   uuid,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE public.ar_credit_notes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ar_credit_notes TO authenticated;

INSERT INTO public.ar_credit_notes (id, note_number, note_type, customer_id, invoice_id, reason, amount, status, property_id)
VALUES
  ('ar_cn_001', 'CN-2024-001', 'Credit', 'ar_cust_techcorp', 'ar_inv_001', 'Overpayment Refund',     2500, 'Applied',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cn_002', 'CN-2024-002', 'Credit', 'ar_cust_abc',      'ar_inv_002', 'Service Discount',       1200, 'Pending',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cn_003', 'DN-2024-001', 'Debit',  'ar_cust_xyz',      'ar_inv_003', 'Additional Charges',      850, 'Applied',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cn_004', 'CN-2024-003', 'Credit', 'ar_cust_corp',     'ar_inv_006', 'Room Change Refund',      450, 'Applied',  '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_cn_005', 'DN-2024-002', 'Debit',  'ar_cust_corp',     'ar_inv_006', 'Late Fee',                200, 'Pending',  '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;

-- ── ar_collections table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ar_collections (
  id              text PRIMARY KEY,
  customer_id     text REFERENCES public.ar_customers(id) ON DELETE SET NULL,
  folio_id        text,
  amount          numeric DEFAULT 0,
  days_overdue    integer DEFAULT 0,
  last_contact    date,
  next_action     text,
  next_action_date date,
  status          text DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Promised', 'Escalated', 'Resolved')),
  notes           text,
  assigned_to     text,
  property_id     uuid,
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.ar_collections ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ar_collections TO authenticated;

INSERT INTO public.ar_collections (id, customer_id, folio_id, amount, days_overdue, last_contact, next_action, next_action_date, status, notes, property_id)
VALUES
  ('ar_col_001', 'ar_cust_techcorp', 'FOL-2024-089', 8500,  45, '2024-06-01', 'Follow-up Call',  '2024-06-15', 'In Progress', 'Customer acknowledged invoice, awaiting payment', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_col_002', 'ar_cust_abc',      'FOL-2024-092', 4200,  15, '2024-06-03', 'Send Reminder',   '2024-06-10', 'Promised',    'Customer promised to pay by end of month',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_col_003', 'ar_cust_xyz',      'FOL-2024-078', 12500, 75, '2024-05-28', 'Escalate',        '2024-06-05', 'Escalated',   'Multiple reminders sent, no response',            '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_col_004', 'ar_cust_corp',     'FOL-2024-095', 1800,   8, '2024-06-05', 'Send Invoice',    '2024-06-12', 'In Progress', 'Invoice being prepared',                          '18762279-a389-41c9-9169-7ebc682e9703'),
  ('ar_col_005', 'ar_cust_tour',     'FOL-2024-082', 6700,  32, '2024-06-02', 'Follow-up Call',  '2024-06-16', 'In Progress', 'Tour operator, standard terms',                   '1579f5e1-3ddc-41d7-bbb0-60ee00ac5f6b')
ON CONFLICT (id) DO NOTHING;
