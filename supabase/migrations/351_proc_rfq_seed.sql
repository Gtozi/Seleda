-- 351_proc_rfq_seed.sql
-- Seeds additional RFQs, RFQ lines, invitations, quotations, and quotation lines
-- to give the RFQ Management tab representative data.
-- Uses the demo property: 18762279-a389-41c9-9169-7ebc682e9703
-- Existing suppliers: sup-001 (Ethiopian Food Supplies), sup-002 (CleanPro Chemicals),
--   sup-003 (Engineering Solutions Corp), sup-004 (Office Depot Ethiopia),
--   sup-005 (Premium Wines Importers)
-- Existing requisitions: req-001 (Kitchen, Approved), req-003 (Engineering, Approved)

BEGIN;

-- ── RFQ 003: Housekeeping Cleaning Supplies (from req-002 concept)─────────
INSERT INTO public.proc_rfqs (id, rfq_number, property_id, department, procurement_officer, issue_date, response_deadline, currency, delivery_requirement, terms, conditions, status, requisition_id, source_system, source_ref, created_at, updated_at)
VALUES (
  'rfq-003', 'RFQ-2026-003', '18762279-a389-41c9-9169-7ebc682e9703',
  'Housekeeping', 'Sara Ahmed',
  NOW() - INTERVAL '5 days', NOW() + INTERVAL '3 days',
  'ETB', 'Deliver to main storage within 7 days of order',
  'Net 30 days', 'Prices valid for 30 days. Samples required.',
  'Issued', NULL, 'procurement', NULL,
  NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'
);

INSERT INTO public.proc_rfq_lines (id, rfq_id, line_number, item_name, specification, quantity, unit_of_measure, required_delivery_date, quality_requirement) VALUES
('rfl-006', 'rfq-003', 1, 'Industrial Laundry Detergent', '25kg drums, commercial grade', 40, 'drums', (NOW() + INTERVAL '10 days')::date, 'Eco-certified, low-foam formula'),
('rfl-007', 'rfq-003', 2, 'Bleach Concentrate', '5L jerrycans', 60, 'jerrycans', (NOW() + INTERVAL '10 days')::date, '5% sodium hypochlorite minimum'),
('rfl-008', 'rfq-003', 3, 'Glass Cleaner', '1L spray bottles', 100, 'bottles', (NOW() + INTERVAL '10 days')::date, 'Streak-free, non-toxic');

INSERT INTO public.proc_rfq_invitations (id, rfq_id, supplier_id, invited_at, status) VALUES
('rfqi-004', 'rfq-003', 'sup-002', NOW() - INTERVAL '5 days', 'Pending'),
('rfqi-005', 'rfq-003', 'sup-001', NOW() - INTERVAL '5 days', 'Pending');

-- Quotation from sup-002 for rfq-003
INSERT INTO public.proc_quotations (id, quotation_number, rfq_id, supplier_id, submitted_at, currency, subtotal, tax, total, lead_time, payment_terms, warranty, quote_validity, status, evaluation_score, created_at)
VALUES (
  'quot-003', 'QT-2026-003', 'rfq-003', 'sup-002',
  NOW() - INTERVAL '2 days', 'ETB',
  28000, 4200, 32200,
  5, 'Net 30', '6 months', (NOW() + INTERVAL '30 days')::date,
  'Received', 88.5, NOW() - INTERVAL '2 days'
);

INSERT INTO public.proc_quotation_lines (id, quotation_id, rfq_line_id, line_number, item_name, quantity, unit_of_measure, unit_price, line_total, lead_time) VALUES
('ql-007', 'quot-003', 'rfl-006', 1, 'Industrial Laundry Detergent', 40, 'drums', 450, 18000, 5),
('ql-008', 'quot-003', 'rfl-007', 2, 'Bleach Concentrate', 60, 'jerrycans', 120, 7200, 5),
('ql-009', 'quot-003', 'rfl-008', 3, 'Glass Cleaner', 100, 'bottles', 70, 7000, 5);

-- ── RFQ 004: F&B Premium Wines (from F&B department) ───────────────────────
INSERT INTO public.proc_rfqs (id, rfq_number, property_id, department, procurement_officer, issue_date, response_deadline, currency, delivery_requirement, terms, conditions, status, requisition_id, source_system, source_ref, created_at, updated_at)
VALUES (
  'rfq-004', 'RFQ-2026-004', '18762279-a389-41c9-9169-7ebc682e9703',
  'Food & Beverage', 'Daniel Bekele',
  NOW() - INTERVAL '3 days', NOW() + INTERVAL '5 days',
  'USD', 'Cold chain delivery, temperature controlled',
  '50% advance, 50% on delivery', 'Import permits and health certificates required',
  'Issued', NULL, 'food_beverage', NULL,
  NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'
);

INSERT INTO public.proc_rfq_lines (id, rfq_id, line_number, item_name, specification, quantity, unit_of_measure, required_delivery_date, quality_requirement) VALUES
('rfl-009', 'rfq-004', 1, 'Red Wine - Cabernet Sauvignon', '750ml, 2019 vintage, premium', 120, 'bottles', (NOW() + INTERVAL '15 days')::date, 'Award-winning vineyard, cork finish'),
('rfl-010', 'rfq-004', 2, 'White Wine - Chardonnay', '750ml, 2020 vintage, premium', 80, 'bottles', (NOW() + INTERVAL '15 days')::date, 'Oaked, award-winning vineyard');

INSERT INTO public.proc_rfq_invitations (id, rfq_id, supplier_id, invited_at, status) VALUES
('rfqi-006', 'rfq-004', 'sup-005', NOW() - INTERVAL '3 days', 'Pending');

-- Quotation from sup-005 for rfq-004
INSERT INTO public.proc_quotations (id, quotation_number, rfq_id, supplier_id, submitted_at, currency, subtotal, tax, total, lead_time, payment_terms, warranty, quote_validity, status, evaluation_score, created_at)
VALUES (
  'quot-004', 'QT-2026-004', 'rfq-004', 'sup-005',
  NOW() - INTERVAL '1 day', 'USD',
  8400, 0, 8400,
  14, '50% advance, 50% on delivery', 'N/A', (NOW() + INTERVAL '45 days')::date,
  'Received', 92.0, NOW() - INTERVAL '1 day'
);

INSERT INTO public.proc_quotation_lines (id, quotation_id, rfq_line_id, line_number, item_name, quantity, unit_of_measure, unit_price, line_total, lead_time) VALUES
('ql-010', 'quot-004', 'rfl-009', 1, 'Red Wine - Cabernet Sauvignon', 120, 'bottles', 45, 5400, 14),
('ql-011', 'quot-004', 'rfl-010', 2, 'White Wine - Chardonnay', 80, 'bottles', 37.5, 3000, 14);

-- ── RFQ 005: Engineering Spare Parts (from Engineering department) ─────────
INSERT INTO public.proc_rfqs (id, rfq_number, property_id, department, procurement_officer, issue_date, response_deadline, currency, delivery_requirement, terms, conditions, status, requisition_id, source_system, source_ref, created_at, updated_at)
VALUES (
  'rfq-005', 'RFQ-2026-005', '18762279-a389-41c9-9169-7ebc682e9703',
  'Engineering & Maintenance', 'Yonas Tadesse',
  NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days',
  'ETB', 'Deliver to engineering workshop',
  'Net 15 days', 'OEM or certified equivalent parts only',
  'Draft', 'req-003', 'engineering', 'req-003',
  NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'
);

INSERT INTO public.proc_rfq_lines (id, rfq_id, line_number, item_name, specification, quantity, unit_of_measure, required_delivery_date, quality_requirement) VALUES
('rfl-011', 'rfq-005', 1, 'AC Compressor', '1.5 ton, 220V, R410A compatible', 2, 'units', (NOW() + INTERVAL '20 days')::date, 'OEM with 12-month warranty'),
('rfl-012', 'rfq-005', 2, 'Thermostat Control', 'Digital, programmable, 220V', 3, 'units', (NOW() + INTERVAL '20 days')::date, 'OEM with 24-month warranty');

INSERT INTO public.proc_rfq_invitations (id, rfq_id, supplier_id, invited_at, status) VALUES
('rfqi-007', 'rfq-005', 'sup-003', NOW() - INTERVAL '1 day', 'Pending');

-- ── RFQ 006: IT Equipment (Draft, from IT department) ──────────────────────
INSERT INTO public.proc_rfqs (id, rfq_number, property_id, department, procurement_officer, issue_date, response_deadline, currency, delivery_requirement, terms, conditions, status, requisition_id, source_system, source_ref, created_at, updated_at)
VALUES (
  'rfq-006', 'RFQ-2026-006', '18762279-a389-41c9-9169-7ebc682e9703',
  'IT', 'Marta Girma',
  NOW(), NOW() + INTERVAL '10 days',
  'ETB', 'Deliver to IT office',
  'Net 30 days', 'Original equipment with manufacturer warranty',
  'Draft', NULL, 'procurement', NULL,
  NOW(), NOW()
);

INSERT INTO public.proc_rfq_lines (id, rfq_id, line_number, item_name, specification, quantity, unit_of_measure, required_delivery_date, quality_requirement) VALUES
('rfl-013', 'rfq-006', 1, 'Network Switch', '24-port Gigabit, managed', 2, 'units', (NOW() + INTERVAL '30 days')::date, 'Enterprise-grade, 5-year warranty'),
('rfl-014', 'rfq-006', 2, 'UPS Battery Backup', '3kVA, online double conversion', 1, 'units', (NOW() + INTERVAL '30 days')::date, 'Enterprise-grade, 3-year warranty');

-- ── RFQ 007: Closed/Awarded RFQ (Kitchen, from req-001) ───────────────────
INSERT INTO public.proc_rfqs (id, rfq_number, property_id, department, procurement_officer, issue_date, response_deadline, currency, delivery_requirement, terms, conditions, status, requisition_id, awarded_supplier_id, awarded_at, award_amount, award_notes, source_system, source_ref, created_at, updated_at)
VALUES (
  'rfq-007', 'RFQ-2026-007', '18762279-a389-41c9-9169-7ebc682e9703',
  'Kitchen', 'Daniel Bekele',
  NOW() - INTERVAL '15 days', NOW() - INTERVAL '8 days',
  'ETB', 'Deliver to main kitchen cold storage',
  'Net 15 days', 'Fresh produce, food safety certificates required',
  'Closed', 'req-001', 'sup-001',
  NOW() - INTERVAL '5 days', 14500,
  'Best price and quality combination. Local supplier with proven track record.',
  'procurement', 'req-001',
  NOW() - INTERVAL '15 days', NOW() - INTERVAL '5 days'
);

INSERT INTO public.proc_rfq_lines (id, rfq_id, line_number, item_name, specification, quantity, unit_of_measure, required_delivery_date, quality_requirement) VALUES
('rfl-015', 'rfq-007', 1, 'Beef Tenderloin', 'Premium grade, fresh', 50, 'kg', (NOW() - INTERVAL '5 days')::date, 'Food safety certified, refrigerated transport'),
('rfl-016', 'rfq-007', 2, 'Olive Oil', 'Extra virgin, 5L tins', 20, 'liters', (NOW() - INTERVAL '5 days')::date, 'Cold pressed, premium grade'),
('rfl-017', 'rfq-007', 3, 'Fresh Vegetables', 'Assorted seasonal, daily fresh', 100, 'kg', (NOW() - INTERVAL '5 days')::date, 'Organic preferred, food safety certified');

INSERT INTO public.proc_rfq_invitations (id, rfq_id, supplier_id, invited_at, responded_at, status) VALUES
('rfqi-008', 'rfq-007', 'sup-001', NOW() - INTERVAL '15 days', NOW() - INTERVAL '10 days', 'Responded'),
('rfqi-009', 'rfq-007', 'sup-005', NOW() - INTERVAL '15 days', NOW() - INTERVAL '9 days', 'Responded');

-- Quotation from sup-001 for rfq-007 (winner)
INSERT INTO public.proc_quotations (id, quotation_number, rfq_id, supplier_id, submitted_at, currency, subtotal, tax, total, lead_time, payment_terms, warranty, quote_validity, status, evaluation_score, created_at)
VALUES (
  'quot-005', 'QT-2026-005', 'rfq-007', 'sup-001',
  NOW() - INTERVAL '10 days', 'ETB',
  12600, 1890, 14490,
  2, 'Net 15', 'N/A', (NOW() - INTERVAL '10 days' + INTERVAL '20 days')::date,
  'Received', 91.0, NOW() - INTERVAL '10 days'
);

INSERT INTO public.proc_quotation_lines (id, quotation_id, rfq_line_id, line_number, item_name, quantity, unit_of_measure, unit_price, line_total, lead_time) VALUES
('ql-012', 'quot-005', 'rfl-015', 1, 'Beef Tenderloin', 50, 'kg', 180, 9000, 2),
('ql-013', 'quot-005', 'rfl-016', 2, 'Olive Oil', 20, 'liters', 150, 3000, 2),
('ql-014', 'quot-005', 'rfl-017', 3, 'Fresh Vegetables', 100, 'kg', 6, 600, 2);

-- Quotation from sup-005 for rfq-007 (runner-up)
INSERT INTO public.proc_quotations (id, quotation_number, rfq_id, supplier_id, submitted_at, currency, subtotal, tax, total, lead_time, payment_terms, warranty, quote_validity, status, evaluation_score, created_at)
VALUES (
  'quot-006', 'QT-2026-006', 'rfq-007', 'sup-005',
  NOW() - INTERVAL '9 days', 'ETB',
  14000, 2100, 16100,
  5, 'Net 30', 'N/A', (NOW() - INTERVAL '9 days' + INTERVAL '20 days')::date,
  'Received', 78.0, NOW() - INTERVAL '9 days'
);

INSERT INTO public.proc_quotation_lines (id, quotation_id, rfq_line_id, line_number, item_name, quantity, unit_of_measure, unit_price, line_total, lead_time) VALUES
('ql-015', 'quot-006', 'rfl-015', 1, 'Beef Tenderloin', 50, 'kg', 200, 10000, 5),
('ql-016', 'quot-006', 'rfl-016', 2, 'Olive Oil', 20, 'liters', 160, 3200, 5),
('ql-017', 'quot-006', 'rfl-017', 3, 'Fresh Vegetables', 100, 'kg', 8, 800, 5);

COMMIT;
