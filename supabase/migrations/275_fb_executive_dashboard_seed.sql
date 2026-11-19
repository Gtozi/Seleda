-- Migration: F&B Executive Dashboard seed data
--
-- Seeds the transactional tables that the /erp/fb/executive-dashboard screen
-- reads from so the dashboard has real data to aggregate. The pre-aggregated
-- analytics snapshots (fb_outlet_analytics, fb_cost_analytics, fb_menu_engineering)
-- are already seeded by migration 266; this migration fills the gaps:
--
--   - fb_suppliers          (needed as FK target for purchase orders)
--   - fb_purchase_orders    (open POs → "Purchase Commitments" KPI)
--   - wastage_logs          (today's entries → "Waste Cost" KPI)
--   - fb_staff_productivity (today's entries → "Staff Productivity" panel)
--   - stock_transactions    (receipts → "Inventory Value" KPI + low-stock alerts)
--   - orders                (today's tickets → meal-period revenue, production
--                            status, void-rate exception)
--   - fb_guest_feedback     (existing table → "Guest Satisfaction" KPI)
--
-- All inserts are idempotent (WHERE NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- Outlet map (already exist in the DB):
--   MAIN (Main Restaurant) = 8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f  → name 'MAIN'
--   La Maison              = 8ad72723-fb18-43b2-9333-6cc6f709f749  → name 'La Maison Restaurant'
--   Sky Lounge Bar         = 907e8a05-57f7-4159-81d3-ad53a1745fa3  → name 'Sky Lounge Bar'
--   Room Service           = 4a3f6574-bde9-47e4-bf8d-1b0c64ca6841  → name 'Room Service'

-- ════════════════════════════════════════════════════════════════════
-- 1. fb_guest_feedback (existing table — backs the Guest Satisfaction KPI)
--    Schema: id, guest_id (FK fb_guest_profiles), date, outlet (TEXT name),
--            type (compliment|complaint|suggestion), rating (1-5, nullable),
--            category (food|service|ambiance|other|menu), description,
--            status (open|in_progress|resolved|closed), created_at, updated_at
-- ════════════════════════════════════════════════════════════════════
INSERT INTO fb_guest_feedback (id, guest_id, date, outlet, type, rating, category, description, status, created_at)
SELECT * FROM (VALUES
  ('GF-EXEC-001'::text, '1'::text, CURRENT_DATE::date, 'MAIN'::text, 'compliment'::text, 5, 'service'::text, 'Excellent service and food quality'::text, 'resolved'::text, (NOW() - INTERVAL '2 hours')::timestamptz),
  ('GF-EXEC-002', '2', CURRENT_DATE, 'La Maison Restaurant', 'compliment', 4, 'ambiance', 'Great ambience, slight delay in main course', 'resolved', NOW() - INTERVAL '4 hours'),
  ('GF-EXEC-003', '3', CURRENT_DATE, 'Sky Lounge Bar', 'compliment', 5, 'service', 'Best cocktails in town!', 'resolved', NOW() - INTERVAL '6 hours'),
  ('GF-EXEC-004', '4', CURRENT_DATE, 'Room Service', 'compliment', 4, 'service', 'Quick room service delivery', 'resolved', NOW() - INTERVAL '1 hour'),
  ('GF-EXEC-005', '1', CURRENT_DATE, 'MAIN', 'compliment', 5, 'food', 'Chef special was outstanding', 'resolved', NOW() - INTERVAL '3 hours'),
  ('GF-EXEC-006', '2', CURRENT_DATE, 'La Maison Restaurant', 'complaint', 3, 'food', 'Food was good but portion seemed small', 'in_progress', NOW() - INTERVAL '5 hours'),
  ('GF-EXEC-007', '3', CURRENT_DATE, 'Sky Lounge Bar', 'compliment', 4, 'menu', 'Nice selection of drinks', 'resolved', NOW() - INTERVAL '8 hours'),
  ('GF-EXEC-008', '4', CURRENT_DATE, 'MAIN', 'compliment', 5, 'service', 'Will definitely come back', 'resolved', NOW() - INTERVAL '7 hours')
) AS t(id, guest_id, date, outlet, type, rating, category, description, status, created_at)
WHERE NOT EXISTS (SELECT 1 FROM fb_guest_feedback WHERE id = t.id);

-- ════════════════════════════════════════════════════════════════════
-- 2. fb_suppliers (needed as FK target for purchase orders)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO fb_suppliers (id, supplier_code, name, contact_person, email, phone, city, country, payment_terms, rating, is_active)
SELECT * FROM (VALUES
  ('SUP-EXEC-001'::text, 'SUP-EXEC-001'::text, 'Premium Foods Ltd'::text, 'Daniel G.'::text, 'orders@premiumfoods.com'::text, '+251911100001'::text, 'Addis Ababa'::text, 'Ethiopia'::text, 30, 4.5, true),
  ('SUP-EXEC-002', 'SUP-EXEC-002', 'Beverage Distributors Inc', 'Sarah P.', 'sales@bevdistrib.com', '+251911100002', 'Addis Ababa', 'Ethiopia', 15, 4.2, true),
  ('SUP-EXEC-003', 'SUP-EXEC-003', 'Fresh Produce Co', 'Mike A.', 'contact@freshproduce.com', '+251911100003', 'Addis Ababa', 'Ethiopia', 7, 4.8, true)
) AS t(id, supplier_code, name, contact_person, email, phone, city, country, payment_terms, rating, is_active)
WHERE NOT EXISTS (SELECT 1 FROM fb_suppliers WHERE id = t.id);

-- ════════════════════════════════════════════════════════════════════
-- 3. fb_purchase_orders (open POs → "Purchase Commitments" KPI)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO fb_purchase_orders (id, po_number, supplier_id, outlet_id, status, order_date, expected_delivery_date, subtotal, tax_amount, total_amount, currency, payment_status, submitted_by)
SELECT * FROM (VALUES
  ('PO-EXEC-001'::text, 'PO-2026-1001'::text, 'SUP-EXEC-001'::text, '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text, 'submitted'::text, NOW()::timestamptz, (NOW() + INTERVAL '3 days')::timestamptz, 2800.00::numeric, 560.00::numeric, 3360.00::numeric, 'ETB'::text, 'pending'::text, 'chef@seleda.com'::text),
  ('PO-EXEC-002', 'PO-2026-1002', 'SUP-EXEC-002', '907e8a05-57f7-4159-81d3-ad53a1745fa3', 'acknowledged', NOW() - INTERVAL '1 day', NOW() + INTERVAL '2 days', 1950.00, 390.00, 2340.00, 'ETB', 'pending', 'bar@seleda.com'),
  ('PO-EXEC-003', 'PO-2026-1003', 'SUP-EXEC-003', '8ad72723-fb18-43b2-9333-6cc6f709f749', 'draft', NOW(), NOW() + INTERVAL '1 day', 1200.00, 240.00, 1440.00, 'ETB', 'pending', 'kitchen@seleda.com'),
  ('PO-EXEC-004', 'PO-2026-1004', 'SUP-EXEC-001', '4a3f6574-bde9-47e4-bf8d-1b0c64ca6841', 'partial', NOW() - INTERVAL '2 days', NOW() + INTERVAL '1 day', 680.00, 136.00, 816.00, 'ETB', 'partial', 'roomservice@seleda.com')
) AS t(id, po_number, supplier_id, outlet_id, status, order_date, expected_delivery_date, subtotal, tax_amount, total_amount, currency, payment_status, submitted_by)
WHERE NOT EXISTS (SELECT 1 FROM fb_purchase_orders WHERE id = t.id);

-- ════════════════════════════════════════════════════════════════════
-- 4. wastage_logs (today's entries → "Waste Cost" KPI)
--    Uses the first available ingredient + stock location dynamically.
-- ════════════════════════════════════════════════════════════════════
INSERT INTO wastage_logs (id, ingredient_id, location_id, quantity, unit, reason, cost_value, logged_by, approved_by, notes, created_at)
SELECT 'WLOG-EXEC-' || LPAD(i.rn::text, 3, '0'),
       i.ingredient_id,
       i.location_id,
       i.quantity,
       i.unit,
       i.reason,
       i.cost_value,
       'system',
       'system',
       'Executive dashboard seed',
       i.created_at
FROM (
  SELECT
    ing.id AS ingredient_id,
    loc.id AS location_id,
    CASE ing.rn
      WHEN 1 THEN 2.5  WHEN 2 THEN 1.8  WHEN 3 THEN 3.2
      WHEN 4 THEN 0.5  WHEN 5 THEN 4.0  ELSE 1.0 END AS quantity,
    'kg' AS unit,
    CASE ing.rn
      WHEN 1 THEN 'Spoilage'::text WHEN 2 THEN 'Breakage'::text
      WHEN 3 THEN 'Overproduction'::text WHEN 4 THEN 'QualityReject'::text
      ELSE 'Other'::text END AS reason,
    CASE ing.rn
      WHEN 1 THEN 85.00  WHEN 2 THEN 120.00 WHEN 3 THEN 65.00
      WHEN 4 THEN 45.00  WHEN 5 THEN 90.00  ELSE 30.00 END AS cost_value,
    CASE ing.rn
      WHEN 1 THEN NOW() - INTERVAL '1 hour'
      WHEN 2 THEN NOW() - INTERVAL '3 hours'
      WHEN 3 THEN NOW() - INTERVAL '5 hours'
      WHEN 4 THEN NOW() - INTERVAL '2 hours'
      ELSE NOW() - INTERVAL '6 hours' END AS created_at,
    ing.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn
    FROM ingredients
    WHERE is_active = true
    ORDER BY name
    LIMIT 5
  ) ing
  CROSS JOIN (SELECT id FROM stock_locations WHERE is_active = true ORDER BY name LIMIT 1) loc
) i
WHERE NOT EXISTS (SELECT 1 FROM wastage_logs WHERE id = 'WLOG-EXEC-' || LPAD(i.rn::text, 3, '0'));

-- ════════════════════════════════════════════════════════════════════
-- 5. fb_staff_productivity (today's entries → "Staff Productivity" panel)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO fb_staff_productivity (id, employee_id, outlet_id, covers_served, revenue, hours, rev_per_hour, created_at)
SELECT * FROM (VALUES
  ('PR-EXEC-001'::text, 'emp-002'::text, '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text, 32, 1420.00::numeric, 8, 177.50::numeric, (NOW() - INTERVAL '2 hours')::timestamptz),
  ('PR-EXEC-002', 'emp-006', '8ad72723-fb18-43b2-9333-6cc6f709f749', 22, 1980.00, 8, 247.50, NOW() - INTERVAL '3 hours'),
  ('PR-EXEC-003', 'emp-004', '907e8a05-57f7-4159-81d3-ad53a1745fa3', 48, 1120.00, 8, 140.00, NOW() - INTERVAL '4 hours'),
  ('PR-EXEC-004', 'emp-007', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 38, 960.00, 8, 120.00, NOW() - INTERVAL '5 hours'),
  ('PR-EXEC-005', 'emp-005', '4a3f6574-bde9-47e4-bf8d-1b0c64ca6841', 18, 540.00, 6, 90.00, NOW() - INTERVAL '2 hours'),
  ('PR-EXEC-006', 'emp-003', '8ad72723-fb18-43b2-9333-6cc6f709f749', 28, 1740.00, 8, 217.50, NOW() - INTERVAL '6 hours')
) AS t(id, employee_id, outlet_id, covers_served, revenue, hours, rev_per_hour, created_at)
WHERE NOT EXISTS (SELECT 1 FROM fb_staff_productivity WHERE id = t.id);

-- ════════════════════════════════════════════════════════════════════
-- 6. stock_transactions (receipts → "Inventory Value" KPI + low-stock alerts)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO stock_transactions (id, ingredient_id, location_id, transaction_type, quantity, unit, cost_per_unit, total_value, date, reference_doc, reference_type, notes)
SELECT 'STX-EXEC-' || LPAD(i.rn::text, 3, '0'),
       i.ingredient_id,
       i.location_id,
       'Receipt',
       i.quantity,
       i.unit,
       i.cost_per_unit,
       i.total_value,
       NOW(),
       'PO-EXEC-SEED',
       'purchase_order',
       'Executive dashboard seed receipt'
FROM (
  SELECT
    ing.id AS ingredient_id,
    loc.id AS location_id,
    CASE ing.rn
      WHEN 1 THEN 50  WHEN 2 THEN 30  WHEN 3 THEN 80
      WHEN 4 THEN 15  WHEN 5 THEN 40  WHEN 6 THEN 25
      WHEN 7 THEN 60  WHEN 8 THEN 35  ELSE 20 END AS quantity,
    'kg' AS unit,
    CASE ing.rn
      WHEN 1 THEN 28.00 WHEN 2 THEN 45.00 WHEN 3 THEN 12.00
      WHEN 4 THEN 85.00 WHEN 5 THEN 22.00 WHEN 6 THEN 38.00
      WHEN 7 THEN 15.00 WHEN 8 THEN 52.00 ELSE 30.00 END AS cost_per_unit,
    CASE ing.rn
      WHEN 1 THEN 1400.00 WHEN 2 THEN 1350.00 WHEN 3 THEN 960.00
      WHEN 4 THEN 1275.00 WHEN 5 THEN 880.00 WHEN 6 THEN 950.00
      WHEN 7 THEN 900.00 WHEN 8 THEN 1820.00 ELSE 600.00 END AS total_value,
    ing.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY name) AS rn
    FROM ingredients
    WHERE is_active = true
    ORDER BY name
    LIMIT 9
  ) ing
  CROSS JOIN (SELECT id FROM stock_locations WHERE is_active = true ORDER BY name LIMIT 1) loc
) i
WHERE NOT EXISTS (SELECT 1 FROM stock_transactions WHERE id = 'STX-EXEC-' || LPAD(i.rn::text, 3, '0'));

-- ════════════════════════════════════════════════════════════════════
-- 7. orders (today's tickets → meal-period revenue, production status,
--            void-rate exception)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO orders (id, outlet_id, table_or_room_or_event_id, customer_type, server_id, status, subtotal, tax_amount, discount_amount, service_charge, total_amount, meal_period, guest_name, created_at)
SELECT * FROM (VALUES
  -- Breakfast (Main Restaurant)
  ('ORD-EXEC-001'::text, '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f'::text, 'T-12'::text, 'Walk-In Guest'::text, 'emp-002'::text, 'Paid'::text, 380.00::numeric, 76.00::numeric, 0.00::numeric, 38.00::numeric, 494.00::numeric, 'Breakfast'::text, 'Guest 1201'::text, (NOW() - INTERVAL '5 hours')::timestamptz),
  ('ORD-EXEC-002', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-08', 'In-House Guest', 'emp-007', 'Paid', 420.00, 84.00, 0.00, 42.00, 546.00, 'Breakfast', 'Guest 1208', NOW() - INTERVAL '6 hours'),
  ('ORD-EXEC-003', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-15', 'Walk-In Guest', 'emp-002', 'Paid', 350.00, 70.00, 0.00, 35.00, 455.00, 'Breakfast', 'Guest 1215', NOW() - INTERVAL '4 hours'),
  -- Lunch (Main Restaurant + La Maison)
  ('ORD-EXEC-004', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-03', 'In-House Guest', 'emp-002', 'Paid', 680.00, 136.00, 0.00, 68.00, 884.00, 'Lunch', 'Guest 1103', NOW() - INTERVAL '2 hours'),
  ('ORD-EXEC-005', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-07', 'Walk-In Guest', 'emp-007', 'Served', 520.00, 104.00, 0.00, 52.00, 676.00, 'Lunch', 'Guest 1107', NOW() - INTERVAL '1 hour'),
  ('ORD-EXEC-006', '8ad72723-fb18-43b2-9333-6cc6f709f749', 'T-02', 'Corporate Client', 'emp-006', 'Paid', 890.00, 178.00, 0.00, 89.00, 1157.00, 'Lunch', 'Hamlin Corp', NOW() - INTERVAL '3 hours'),
  ('ORD-EXEC-007', '8ad72723-fb18-43b2-9333-6cc6f709f749', 'T-05', 'In-House Guest', 'emp-003', 'Sent', 720.00, 144.00, 0.00, 72.00, 936.00, 'Lunch', 'Guest 1205', NOW() - INTERVAL '1 hour'),
  ('ORD-EXEC-008', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-09', 'Walk-In Guest', 'emp-002', 'Open', 410.00, 82.00, 0.00, 41.00, 533.00, 'Lunch', 'Guest 1109', NOW() - INTERVAL '30 minutes'),
  -- Dinner (pre-orders already sent to kitchen)
  ('ORD-EXEC-009', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-01', 'In-House Guest', 'emp-002', 'Sent', 980.00, 196.00, 0.00, 98.00, 1274.00, 'Dinner', 'Guest 1201', NOW() - INTERVAL '15 minutes'),
  ('ORD-EXEC-010', '8ad72723-fb18-43b2-9333-6cc6f709f749', 'T-04', 'Walk-In Guest', 'emp-006', 'Sent', 1240.00, 248.00, 0.00, 124.00, 1612.00, 'Dinner', 'Guest 1210', NOW() - INTERVAL '10 minutes'),
  ('ORD-EXEC-011', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-06', 'In-House Guest', 'emp-007', 'Open', 560.00, 112.00, 0.00, 56.00, 728.00, 'Dinner', 'Guest 1206', NOW() - INTERVAL '5 minutes'),
  -- Bar Service (Sky Lounge)
  ('ORD-EXEC-012', '907e8a05-57f7-4159-81d3-ad53a1745fa3', 'BAR-1', 'Walk-In Guest', 'emp-004', 'Paid', 340.00, 68.00, 0.00, 34.00, 442.00, 'Dinner', 'Guest 1301', NOW() - INTERVAL '2 hours'),
  ('ORD-EXEC-013', '907e8a05-57f7-4159-81d3-ad53a1745fa3', 'BAR-2', 'Walk-In Guest', 'emp-004', 'Served', 280.00, 56.00, 0.00, 28.00, 364.00, 'Dinner', 'Guest 1302', NOW() - INTERVAL '1 hour'),
  -- Room Service
  ('ORD-EXEC-014', '4a3f6574-bde9-47e4-bf8d-1b0c64ca6841', 'R-205', 'In-House Guest', 'emp-005', 'Paid', 180.00, 36.00, 0.00, 18.00, 234.00, 'Dinner', 'Guest 1205', NOW() - INTERVAL '3 hours'),
  ('ORD-EXEC-015', '4a3f6574-bde9-47e4-bf8d-1b0c64ca6841', 'R-312', 'In-House Guest', 'emp-005', 'Served', 220.00, 44.00, 0.00, 22.00, 286.00, 'Dinner', 'Guest 1312', NOW() - INTERVAL '1 hour'),
  -- Voided order (for void-rate exception)
  ('ORD-EXEC-016', '8f7a343f-1dc2-47a1-b7b5-a133c47a9a7f', 'T-11', 'Walk-In Guest', 'emp-002', 'Void', 290.00, 58.00, 0.00, 29.00, 377.00, 'Lunch', 'Guest 1111', NOW() - INTERVAL '2 hours')
) AS t(id, outlet_id, table_or_room_or_event_id, customer_type, server_id, status, subtotal, tax_amount, discount_amount, service_charge, total_amount, meal_period, guest_name, created_at)
WHERE NOT EXISTS (SELECT 1 FROM orders WHERE id = t.id);

-- Update voided order with void metadata
UPDATE orders SET void_reason = 'Customer cancelled after order sent', voided_by = 'emp-002', voided_at = NOW() - INTERVAL '2 hours'
WHERE id = 'ORD-EXEC-016' AND voided_at IS NULL;
