-- 451_event_billing_mock_data.sql
--
-- Seed event_charges and folio_payments with realistic mock data
-- so the Billing tab has charge breakdowns and payment history to display.
-- The backend endpoints already exist; this just populates the data.

-- ── 1. Event charges (charge breakdowns per event) ──────────────────
-- We use the price_event_charge function to compute gross/discount/tax/total.
-- But since that function expects a single row to exist first, we insert
-- with manually computed amounts.

INSERT INTO public.event_charges (property_id, event_id, charge_type, description, quantity, unit_price, gross_amount, discount_percent, discount_amount, net_amount, service_charge_amount, tax_amount, total_amount, is_taxable, is_service_charged, revenue_account_code, is_manual, created_at) VALUES
  -- event-001: TechCorp Annual Conference (grand_total 4862)
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'VenueRental', 'Crystal Ballroom A — full day hire', 1, 2500.00, 2500.00, 0, 0, 2500.00, 250.00, 375.00, 3125.00, true, true, '4050', false, '2026-09-01 10:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Catering', 'Lunch buffet — 300 pax @ ETB 350', 300, 350.00, 105000.00, 0, 0, 105000.00, 5250.00, 7875.00, 118125.00, true, true, '4060', false, '2026-09-01 10:05:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Equipment', 'Projector + LED screen + wireless mics', 1, 800.00, 800.00, 0, 0, 800.00, 80.00, 120.00, 1000.00, true, true, '4070', false, '2026-09-01 10:10:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-001', 'Beverage', 'Coffee break service — 300 pax', 300, 45.00, 13500.00, 0, 0, 13500.00, 675.00, 1012.50, 15187.50, true, true, '4061', false, '2026-09-01 10:15:00+03'),

  -- event-002: Royal Wedding Reception (grand_total 7040)
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'VenueRental', 'Grand Ballroom — evening hire', 1, 3500.00, 3500.00, 0, 0, 3500.00, 350.00, 525.00, 4375.00, true, true, '4050', false, '2026-09-05 14:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Catering', '5-course plated dinner — 250 pax @ ETB 850', 250, 850.00, 212500.00, 0, 0, 212500.00, 10625.00, 15937.50, 239062.50, true, true, '4060', false, '2026-09-05 14:05:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Beverage', 'Open bar — champagne toast + wine pairing', 250, 120.00, 30000.00, 0, 0, 30000.00, 1500.00, 2250.00, 33750.00, true, true, '4061', false, '2026-09-05 14:10:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-002', 'Decoration', 'Floral arrangements + centerpieces + lighting', 1, 4500.00, 4500.00, 0, 0, 4500.00, 450.00, 675.00, 5625.00, true, true, '4080', true, '2026-09-05 14:15:00+03'),

  -- event-006: African Union Forum (grand_total 1860)
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'VenueRental', 'Terrace Lounge + Azure Room — half day', 1, 1200.00, 1200.00, 0, 0, 1200.00, 120.00, 180.00, 1500.00, true, true, '4050', false, '2026-09-10 09:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Catering', 'Continental breakfast + afternoon tea — 90 pax', 90, 65.00, 5850.00, 0, 0, 5850.00, 292.50, 438.75, 6581.25, true, true, '4060', false, '2026-09-10 09:05:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-006', 'Equipment', 'Translation headsets — 90 units', 90, 15.00, 1350.00, 0, 0, 1350.00, 67.50, 101.25, 1518.75, true, true, '4070', false, '2026-09-10 09:10:00+03'),

  -- event-007: Addis Fashion Week Gala (grand_total 6800)
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-007', 'VenueRental', 'Grand Ballroom — full day fashion show', 1, 4000.00, 4000.00, 0, 0, 4000.00, 400.00, 600.00, 5000.00, true, true, '4050', false, '2026-09-08 11:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-007', 'Equipment', 'Runway lighting + sound system + LED backdrop', 1, 1500.00, 1500.00, 0, 0, 1500.00, 150.00, 225.00, 1875.00, true, true, '4070', false, '2026-09-08 11:05:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'event-007', 'Catering', 'Cocktail reception — 200 pax', 200, 180.00, 36000.00, 0, 0, 36000.00, 1800.00, 2700.00, 40500.00, true, true, '4060', false, '2026-09-08 11:10:00+03'),

  -- event-003: Gala Dinner (grand_total from BEO-DEMO-001)
  ('18762279-a389-41c9-9169-7ebc682e9703', 'BEO-DEMO-001', 'VenueRental', 'Grand Ballroom — gala dinner', 1, 3000.00, 3000.00, 0, 0, 3000.00, 300.00, 450.00, 3750.00, true, true, '4050', false, '2026-09-03 10:00:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'BEO-DEMO-001', 'Catering', '3-course plated dinner — 180 pax @ ETB 750', 180, 750.00, 135000.00, 0, 0, 135000.00, 6750.00, 10125.00, 151875.00, true, true, '4060', false, '2026-09-03 10:05:00+03'),
  ('18762279-a389-41c9-9169-7ebc682e9703', 'BEO-DEMO-001', 'Beverage', 'Wine pairing service — 180 pax', 180, 95.00, 17100.00, 0, 0, 17100.00, 855.00, 1282.50, 19237.50, true, true, '4061', false, '2026-09-03 10:10:00+03')
ON CONFLICT DO NOTHING;

-- ── 2. Folio payments ──────────────────────────────────────────────
-- event-001 has folio_id cb5bfeb1-1b3e-4430-a6be-cb321e04d814
-- We need to create folios for other events first, or insert payments
-- against the existing folio.

-- Payment for event-001 (deposit already recorded as 2500)
INSERT INTO public.folio_payments (id, folio_id, property_id, payment_date, amount, payment_method, payment_sub_type, reference_number, is_voided, is_refund, posted_to_gl, created_at, notes) VALUES
  ('pay-001-deposit', 'cb5bfeb1-1b3e-4430-a6be-cb321e04d814', '18762279-a389-41c9-9169-7ebc682e9703', '2026-08-20 14:30:00+03', 2500.00, 'Bank Transfer', 'EventDeposit', 'TRF-2026-0042', false, false, true, '2026-08-20 14:30:00+03', 'Deposit for TechCorp Annual Conference — 50% of venue hire'),
  ('pay-001-partial', 'cb5bfeb1-1b3e-4430-a6be-cb321e04d814', '18762279-a389-41c9-9169-7ebc682e9703', '2026-09-12 10:15:00+03', 1000.00, 'Credit Card', 'EventPayment', 'CC-2026-0789', false, false, false, '2026-09-12 10:15:00+03', 'Partial payment — balance settlement on event day')
ON CONFLICT DO NOTHING;

-- Create folios for events that don't have one and add payments
-- event-002: Royal Wedding Reception
INSERT INTO public.folios (id, property_id, folio_type, status, balance, created_at, updated_at)
SELECT 'folio-event-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Event', 'Open', 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.folios WHERE id = 'folio-event-002');

UPDATE public.event_bookings SET folio_id = 'folio-event-002' WHERE id = 'event-002' AND folio_id IS NULL;

INSERT INTO public.folio_payments (id, folio_id, property_id, payment_date, amount, payment_method, payment_sub_type, reference_number, is_voided, is_refund, posted_to_gl, created_at, notes) VALUES
  ('pay-002-deposit', 'folio-event-002', '18762279-a389-41c9-9169-7ebc682e9703', '2026-09-01 09:00:00+03', 5000.00, 'Bank Transfer', 'EventDeposit', 'TRF-2026-0051', false, false, true, '2026-09-01 09:00:00+03', 'Deposit for Royal Wedding Reception')
ON CONFLICT DO NOTHING;

-- event-006: African Union Forum
INSERT INTO public.folios (id, property_id, folio_type, status, balance, created_at, updated_at)
SELECT 'folio-event-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Event', 'Open', 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.folios WHERE id = 'folio-event-006');

UPDATE public.event_bookings SET folio_id = 'folio-event-006' WHERE id = 'event-006' AND folio_id IS NULL;

INSERT INTO public.folio_payments (id, folio_id, property_id, payment_date, amount, payment_method, payment_sub_type, reference_number, is_voided, is_refund, posted_to_gl, created_at, notes) VALUES
  ('pay-006-deposit', 'folio-event-006', '18762279-a389-41c9-9169-7ebc682e9703', '2026-09-15 11:30:00+03', 1800.00, 'Bank Transfer', 'EventDeposit', 'TRF-AU-0033', false, false, true, '2026-09-15 11:30:00+03', 'Deposit for African Union Forum — corporate billing')
ON CONFLICT DO NOTHING;

-- event-007: Addis Fashion Week Gala
INSERT INTO public.folios (id, property_id, folio_type, status, balance, created_at, updated_at)
SELECT 'folio-event-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Event', 'Open', 0, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.folios WHERE id = 'folio-event-007');

UPDATE public.event_bookings SET folio_id = 'folio-event-007' WHERE id = 'event-007' AND folio_id IS NULL;

INSERT INTO public.folio_payments (id, folio_id, property_id, payment_date, amount, payment_method, payment_sub_type, reference_number, is_voided, is_refund, posted_to_gl, created_at, notes) VALUES
  ('pay-007-deposit', 'folio-event-007', '18762279-a389-41c9-9169-7ebc682e9703', '2026-09-05 16:00:00+03', 8000.00, 'Cheque', 'EventDeposit', 'CHQ-2026-0118', false, false, true, '2026-09-05 16:00:00+03', 'Deposit for Addis Fashion Week Gala')
ON CONFLICT DO NOTHING;

