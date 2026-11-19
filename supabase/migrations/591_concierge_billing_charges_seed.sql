-- Migration 591: Concierge billing & charges seed
--
-- The Billing & Charges module previously fabricated amounts with
-- Math.random() over completed requests. Real charges live in the shared
-- folio system: folios (Guest type, linked to reservations) + folio_lines
-- tagged source_module='concierge', department='Concierge'.

-- ── Guest folios for seeded concierge reservations ────────────────────────
INSERT INTO folios (
  id, reservation_id, folio_type, status, balance,
  total_charges, total_payments, currency, opened_at, closed_at, created_by
) VALUES
('folio-consc-i01', 'RES-CONSC-I01', 'Guest', 'Open', 220.00, 220.00, 0.00, 'USD', now() - interval '3 days', NULL, NULL),
('folio-consc-i02', 'RES-CONSC-I02', 'Guest', 'Open', 60.00, 60.00, 0.00, 'USD', now() - interval '3 days', NULL, NULL),
('folio-consc-i03', 'RES-CONSC-I03', 'Guest', 'Open', 35.00, 35.00, 0.00, 'USD', now() - interval '2 days', NULL, NULL),
('folio-consc-a01', 'RES-CONSC-A01', 'Guest', 'Open', 210.00, 210.00, 0.00, 'USD', now() - interval '1 day', NULL, NULL),
('folio-consc-d01', 'RES-CONSC-D01', 'Guest', 'Closed', 0.00, 95.00, 95.00, 'USD', now() - interval '4 days', now() - interval '20 hours', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Concierge charge lines ────────────────────────────────────────────────
INSERT INTO folio_lines (
  id, folio_id, line_number, transaction_date, posting_date,
  description, amount, quantity, unit_price, line_type,
  source_module, department, reservation_id, created_by, is_voided
) VALUES
('fl-consc-001', 'folio-consc-i01', 1, current_date - 1, now() - interval '26 hours',
 'City tour — Addis Highlights Day (2 pax)', 190.00, 1, 190.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-I01', NULL, false),
('fl-consc-002', 'folio-consc-i01', 2, current_date - 1, now() - interval '25 hours',
 'Fendika Azmari Bet — entry tickets ×2', 30.00, 2, 15.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-I01', NULL, false),
('fl-consc-003', 'folio-consc-i02', 1, current_date - 2, now() - interval '50 hours',
 'Personal shopping escort — Shiromeda', 20.00, 1, 20.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-I02', NULL, false),
('fl-consc-004', 'folio-consc-i02', 2, current_date - 1, now() - interval '30 hours',
 'Unity Park — entry tickets ×2', 40.00, 2, 20.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-I02', NULL, false),
('fl-consc-005', 'folio-consc-i03', 1, current_date - 1, now() - interval '28 hours',
 'VIP kids welcome amenity package', 35.00, 1, 35.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-I03', NULL, false),
('fl-consc-006', 'folio-consc-a01', 1, current_date, now() - interval '8 hours',
 'VIP airport pickup — executive sedan', 60.00, 1, 60.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-A01', NULL, false),
('fl-consc-007', 'folio-consc-a01', 2, current_date, now() - interval '6 hours',
 'Private shopping day — dedicated escort', 150.00, 1, 150.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-A01', NULL, false),
('fl-consc-008', 'folio-consc-d01', 1, current_date - 3, now() - interval '74 hours',
 'Merkato shopping escort — half day', 45.00, 1, 45.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-D01', NULL, false),
('fl-consc-009', 'folio-consc-d01', 2, current_date - 2, now() - interval '50 hours',
 'National Theatre — tickets ×2', 50.00, 2, 25.00, 'ServiceCharge',
 'concierge', 'Concierge', 'RES-CONSC-D01', NULL, false)
ON CONFLICT (id) DO NOTHING;
