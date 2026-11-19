-- ============================================================
-- Unified Inventory — Cross-Department Seed (Migration 360)
-- ============================================================
-- Expands the migration 346 seed so the /erp/inventory portal
-- shows realistic data spanning ALL 17 ERP departments.
--
-- Adds:
--   1 General/Office store + locations
--   14 new items (one per previously-uncovered department)
--   14 stock balances
--   17 department issues (one per department) with line items
--   cross-store transfers, waste, counts, reservations, ledger
--
-- Idempotent: every INSERT uses ON CONFLICT (id) DO NOTHING.
-- Demo property id matches migration 346 / HK / Eng portals.
-- ============================================================

DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- ── General / Office store (serves non-operational departments) ──
  INSERT INTO public.uinv_stores (id, property_id, store_code, store_name, store_type, manager, location, capacity, temperature_zone, is_active) VALUES
    ('UINV-ST-GEN', prop_id, 'GEN', 'General Store', 'Warehouse', 'John Storekeeper', 'Admin Block', 20000, 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.uinv_locations (id, store_id, location_code, location_name, location_type, temperature_zone, is_active) VALUES
    ('UINV-LOC-GEN-1', 'UINV-ST-GEN', 'GEN-1', 'General Shelf 1', 'Shelf', 'Ambient', true),
    ('UINV-LOC-GEN-2', 'UINV-ST-GEN', 'GEN-2', 'General Shelf 2', 'Shelf', 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── Items — one per previously-uncovered department ──
  INSERT INTO public.uinv_items (id, property_id, item_code, item_name, description, category, subcategory, item_type, brand, unit_of_measure, batch_controlled, expiry_controlled, fefo_required, min_stock, max_stock, reorder_point, safety_stock, par_level, default_store_id, costing_method, last_cost, avg_cost, standard_cost, is_active) VALUES
    ('UINV-IT-011', prop_id, 'FO-001',  'Front Office Welcome Pack',      'Guest welcome folder with map & coupons', 'Front Office',     'Guest Supplies',     'Consumable',  'Hospitality Co',  'pcs', false, false, false, 50,  1000, 100, 25,  300, 'UINV-ST-GEN', 'Weighted Average', 4.50,  4.50,  4.30,  true),
    ('UINV-IT-012', prop_id, 'FIN-001', 'Printer Toner Cartridge',        'Laser printer toner (black)',             'Finance',          'Office Supplies',    'Consumable',  'PrintTech',       'pcs', false, false, false, 5,   60,   10,  3,   20,  'UINV-ST-GEN', 'Weighted Average', 85.00, 85.00, 84.00, true),
    ('UINV-IT-013', prop_id, 'HR-001',  'Employee ID Card Blanks',        'Blank RFID ID cards for lanyards',        'Human Resources',  'HR Supplies',        'Consumable',  'SecureID',        'pcs', false, false, false, 100, 2000, 200, 50,  500, 'UINV-ST-GEN', 'Weighted Average', 2.80,  2.80,  2.70,  true),
    ('UINV-IT-014', prop_id, 'SEC-001', 'Walkie Talkie Battery Pack',     'Rechargeable radio battery',              'Security',         'Security Equipment', 'Spare Part',  'RadioCom',        'pcs', false, false, false, 8,   80,   15,  4,   30,  'UINV-ST-GEN', 'Weighted Average', 32.00, 32.00, 31.00, true),
    ('UINV-IT-015', prop_id, 'PRC-001', 'Office Stationery Pack',         'Pens, notepad, clips assorted',           'Procurement',      'Office Supplies',    'Consumable',  'OfficePlus',      'pack',false, false, false, 30,  500,  60,  15,  150, 'UINV-ST-GEN', 'Weighted Average', 6.00,  6.00,  5.80,  true),
    ('UINV-IT-016', prop_id, 'SAL-001', 'Sales Brochure Pack',            'Property brochure & rate cards',          'Sales',            'Marketing Materials','Consumable',  'BrandPrint',      'pack',false, false, false, 40,  800,  80,  20,  200, 'UINV-ST-GEN', 'Weighted Average', 3.20,  3.20,  3.10,  true),
    ('UINV-IT-017', prop_id, 'TRP-001', 'Engine Oil 5W-30 (5L)',          'Synthetic motor oil for fleet',           'Transportation',   'Vehicle Supplies',   'Consumable',  'MobilGuard',      'ltr', false, false, false, 20,  300,  40,  10,  100, 'UINV-ST-GEN', 'Weighted Average', 14.00, 14.00, 13.50, true),
    ('UINV-IT-018', prop_id, 'CON-001', 'City Map & Guide Brochures',     'Concierge guest info brochures',          'Concierge',        'Guest Services',     'Consumable',  'CityGuide',       'pcs', false, false, false, 100, 3000, 300, 50,  800, 'UINV-ST-GEN', 'Weighted Average', 0.90,  0.90,  0.85,  true),
    ('UINV-IT-019', prop_id, 'SPA-001', 'Aromatherapy Massage Oil 1L',    'Blended essential massage oil',           'Spa & Wellness',   'Spa Supplies',       'Consumable',  'PureScent',       'ltr', false, true,  true,  10,  120,  20,  5,   50,  'UINV-ST-GEN', 'Weighted Average', 28.00, 28.00, 27.50, true),
    ('UINV-IT-020', prop_id, 'BQT-001', 'Tablecloth White Round 3m',      'Banquet round table linen',               'Banquet & Events', 'Banquet Supplies',   'Consumable',  'LinenPro',        'pcs', false, false, false, 30,  400,  60,  15,  150, 'UINV-ST-GEN', 'Weighted Average', 12.00, 12.00, 11.50, true),
    ('UINV-IT-021', prop_id, 'OPS-001', 'Batteries AA (24-pack)',         'Alkaline AA battery pack',                'Operations',       'Operations Supplies','Consumable',  'DuracellPro',     'pack',false, false, false, 15,  250,  30,  8,   80,  'UINV-ST-GEN', 'Weighted Average', 16.00, 16.00, 15.50, true),
    ('UINV-IT-022', prop_id, 'ADM-001', 'A4 Paper Ream (500)',            'White copy paper ream',                   'Admin',            'Office Supplies',    'Consumable',  'PaperWorld',      'ream',false, false, false, 50,  1500, 150, 30,  400, 'UINV-ST-GEN', 'Weighted Average', 4.00,  4.00,  3.90,  true),
    ('UINV-IT-023', prop_id, 'EXE-001', 'Executive Leather Notepad',      'Branded executive notebook',              'Executive',        'Office Supplies',    'Consumable',  'LuxNote',         'pcs', false, false, false, 10,  150,  20,  5,   50,  'UINV-ST-GEN', 'Weighted Average', 22.00, 22.00, 21.50, true),
    ('UINV-IT-024', prop_id, 'FB-001',  'Olive Oil Extra Virgin 5L',      'Cold-pressed cooking olive oil',          'Food & Beverage',  'Pantry',             'Food',        'Mediterra',       'ltr', false, true,  false, 15,  200,  30,  8,   80,  'UINV-ST-FOOD', 'Weighted Average', 19.00, 19.00, 18.50, true)
  ON CONFLICT (id) DO NOTHING;

  -- ── Stock balances for the new items ──
  INSERT INTO public.uinv_stock_balances (id, property_id, item_id, store_id, location_id, on_hand, reserved, allocated, on_order, in_transit, damaged, quarantined, expired, status, unit_cost) VALUES
    ('UINV-SB-011', prop_id, 'UINV-IT-011', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 320,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 4.50),
    ('UINV-SB-012', prop_id, 'UINV-IT-012', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 8,    0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 85.00),
    ('UINV-SB-013', prop_id, 'UINV-IT-013', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 540,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 2.80),
    ('UINV-SB-014', prop_id, 'UINV-IT-014', 'UINV-ST-GEN',  'UINV-LOC-GEN-2', 12,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 32.00),
    ('UINV-SB-015', prop_id, 'UINV-IT-015', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 180,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 6.00),
    ('UINV-SB-016', prop_id, 'UINV-IT-016', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 220,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 3.20),
    ('UINV-SB-017', prop_id, 'UINV-IT-017', 'UINV-ST-GEN',  'UINV-LOC-GEN-2', 35,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 14.00),
    ('UINV-SB-018', prop_id, 'UINV-IT-018', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 950,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 0.90),
    ('UINV-SB-019', prop_id, 'UINV-IT-019', 'UINV-ST-GEN',  'UINV-LOC-GEN-2', 18,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 28.00),
    ('UINV-SB-020', prop_id, 'UINV-IT-020', 'UINV-ST-GEN',  'UINV-LOC-GEN-2', 75,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 12.00),
    ('UINV-SB-021', prop_id, 'UINV-IT-021', 'UINV-ST-GEN',  'UINV-LOC-GEN-2', 42,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 16.00),
    ('UINV-SB-022', prop_id, 'UINV-IT-022', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 480,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 4.00),
    ('UINV-SB-023', prop_id, 'UINV-IT-023', 'UINV-ST-GEN',  'UINV-LOC-GEN-1', 35,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 22.00),
    ('UINV-SB-024', prop_id, 'UINV-IT-024', 'UINV-ST-FOOD','UINV-LOC-FOOD-DRY', 22, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 19.00)
  ON CONFLICT (id) DO NOTHING;

  -- ── Department issues — one per department (cross-department integration) ──
  -- Statuses span Pending / Approved / Issued / Completed to exercise the workflow.
  INSERT INTO public.uinv_issues (id, property_id, issue_number, department, requester, store_id, required_date, priority, cost_center, purpose, lines, approval_status, issued_by, issued_at) VALUES
    ('UINV-IS-004', prop_id, 'ISS-2026-0004', 'Front Office',     'Sarah Desk',     'UINV-ST-GEN',  '2026-08-30', 'Normal',  'FO-CC-02',  'Desk welcome packs',
      '[{"itemId":"UINV-IT-011","itemName":"Front Office Welcome Pack","requestedQty":100,"approvedQty":100,"issuedQty":100,"unit":"pcs"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-28 08:30:00+00'),
    ('UINV-IS-005', prop_id, 'ISS-2026-0005', 'Housekeeping',     'Alice Johnson',  'UINV-ST-HK',   '2026-08-29', 'Normal',  'HK-CC-02',  'Amenity restock',
      '[{"itemId":"UINV-IT-004","itemName":"Luxury Shampoo 30ml","requestedQty":300,"approvedQty":0,"issuedQty":0,"unit":"pcs"}]'::jsonb,
      'Pending', NULL, NULL),
    ('UINV-IS-006', prop_id, 'ISS-2026-0006', 'Food & Beverage',  'Chef Marco',     'UINV-ST-FOOD', '2026-08-29', 'High',    'FB-CC-02',  'Pantry restock',
      '[{"itemId":"UINV-IT-024","itemName":"Olive Oil Extra Virgin 5L","requestedQty":10,"approvedQty":10,"issuedQty":10,"unit":"ltr"},{"itemId":"UINV-IT-008","itemName":"Ethiopian Coffee Beans 1kg","requestedQty":5,"approvedQty":5,"issuedQty":5,"unit":"kg"}]'::jsonb,
      'Completed', 'John Storekeeper', '2026-08-27 14:00:00+00'),
    ('UINV-IS-007', prop_id, 'ISS-2026-0007', 'Engineering',      'Tom Bradley',    'UINV-ST-ENG',  '2026-08-30', 'Urgent',  'ENG-CC-02', 'HVAC filter swap',
      '[{"itemId":"UINV-IT-010","itemName":"Air Filter 16x25x1","requestedQty":12,"approvedQty":12,"issuedQty":0,"unit":"pcs"}]'::jsonb,
      'Approved', NULL, NULL),
    ('UINV-IS-008', prop_id, 'ISS-2026-0008', 'Inventory',        'John Storekeeper','UINV-ST-GEN', '2026-08-31', 'Normal',  'INV-CC-01', 'Stockroom supplies',
      '[{"itemId":"UINV-IT-022","itemName":"A4 Paper Ream (500)","requestedQty":50,"approvedQty":50,"issuedQty":50,"unit":"ream"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-28 09:00:00+00'),
    ('UINV-IS-009', prop_id, 'ISS-2026-0009', 'Finance',          'Linda Accts',    'UINV-ST-GEN',  '2026-08-30', 'Normal',  'FIN-CC-02', 'Printer supplies',
      '[{"itemId":"UINV-IT-012","itemName":"Printer Toner Cartridge","requestedQty":3,"approvedQty":0,"issuedQty":0,"unit":"pcs"}]'::jsonb,
      'Pending', NULL, NULL),
    ('UINV-IS-010', prop_id, 'ISS-2026-0010', 'Human Resources',  'Mark HR',        'UINV-ST-GEN',  '2026-09-01', 'Normal',  'HR-CC-02',  'New hire ID cards',
      '[{"itemId":"UINV-IT-013","itemName":"Employee ID Card Blanks","requestedQty":150,"approvedQty":150,"issuedQty":150,"unit":"pcs"}]'::jsonb,
      'Completed', 'John Storekeeper', '2026-08-26 10:00:00+00'),
    ('UINV-IS-011', prop_id, 'ISS-2026-0011', 'Security',         'Officer Daniels','UINV-ST-GEN',  '2026-08-29', 'High',    'SEC-CC-02', 'Radio battery rotation',
      '[{"itemId":"UINV-IT-014","itemName":"Walkie Talkie Battery Pack","requestedQty":6,"approvedQty":6,"issuedQty":6,"unit":"pcs"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-28 16:00:00+00'),
    ('UINV-IS-012', prop_id, 'ISS-2026-0012', 'Executive',        'EA Powell',      'UINV-ST-GEN',  '2026-08-30', 'Normal',  'EXE-CC-02', 'Exec office supplies',
      '[{"itemId":"UINV-IT-023","itemName":"Executive Leather Notepad","requestedQty":10,"approvedQty":10,"issuedQty":0,"unit":"pcs"}]'::jsonb,
      'Approved', NULL, NULL),
    ('UINV-IS-013', prop_id, 'ISS-2026-0013', 'Admin',            'Pat Admin',      'UINV-ST-GEN',  '2026-08-30', 'Normal',  'ADM-CC-02', 'Office paper',
      '[{"itemId":"UINV-IT-022","itemName":"A4 Paper Ream (500)","requestedQty":100,"approvedQty":100,"issuedQty":100,"unit":"ream"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-28 11:00:00+00'),
    ('UINV-IS-014', prop_id, 'ISS-2026-0014', 'Procurement',      'Dan Purchasing', 'UINV-ST-GEN',  '2026-08-29', 'Normal',  'PRC-CC-02', 'Stationery for buyers',
      '[{"itemId":"UINV-IT-015","itemName":"Office Stationery Pack","requestedQty":40,"approvedQty":40,"issuedQty":40,"unit":"pack"}]'::jsonb,
      'Completed', 'John Storekeeper', '2026-08-25 09:00:00+00'),
    ('UINV-IS-015', prop_id, 'ISS-2026-0015', 'Operations',       'Ops Lead',       'UINV-ST-GEN',  '2026-08-30', 'Normal',  'OPS-CC-02', 'Battery stock for devices',
      '[{"itemId":"UINV-IT-021","itemName":"Batteries AA (24-pack)","requestedQty":20,"approvedQty":0,"issuedQty":0,"unit":"pack"}]'::jsonb,
      'Pending', NULL, NULL),
    ('UINV-IS-016', prop_id, 'ISS-2026-0016', 'Sales',            'Rita Sales',     'UINV-ST-GEN',  '2026-08-29', 'Normal',  'SAL-CC-02', 'Site visit brochures',
      '[{"itemId":"UINV-IT-016","itemName":"Sales Brochure Pack","requestedQty":60,"approvedQty":60,"issuedQty":60,"unit":"pack"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-27 13:00:00+00'),
    ('UINV-IS-017', prop_id, 'ISS-2026-0017', 'Transportation',   'Frank Fleet',    'UINV-ST-GEN',  '2026-08-30', 'High',    'TRP-CC-02', 'Shuttle oil change',
      '[{"itemId":"UINV-IT-017","itemName":"Engine Oil 5W-30 (5L)","requestedQty":15,"approvedQty":15,"issuedQty":0,"unit":"ltr"}]'::jsonb,
      'Approved', NULL, NULL),
    ('UINV-IS-018', prop_id, 'ISS-2026-0018', 'Concierge',        'Eric Concierge', 'UINV-ST-GEN',  '2026-08-29', 'Normal',  'CON-CC-02', 'Guest info brochures',
      '[{"itemId":"UINV-IT-018","itemName":"City Map & Guide Brochures","requestedQty":200,"approvedQty":200,"issuedQty":200,"unit":"pcs"}]'::jsonb,
      'Completed', 'John Storekeeper', '2026-08-26 15:00:00+00'),
    ('UINV-IS-019', prop_id, 'ISS-2026-0019', 'Spa & Wellness',   'Nina Spa',       'UINV-ST-GEN',  '2026-08-30', 'Normal',  'SPA-CC-02', 'Massage oil restock',
      '[{"itemId":"UINV-IT-019","itemName":"Aromatherapy Massage Oil 1L","requestedQty":8,"approvedQty":0,"issuedQty":0,"unit":"ltr"}]'::jsonb,
      'Pending', NULL, NULL),
    ('UINV-IS-020', prop_id, 'ISS-2026-0020', 'Banquet & Events', 'Banquet Mgr',    'UINV-ST-GEN',  '2026-08-31', 'High',    'BQT-CC-02', 'Event linen setup',
      '[{"itemId":"UINV-IT-020","itemName":"Tablecloth White Round 3m","requestedQty":40,"approvedQty":40,"issuedQty":40,"unit":"pcs"}]'::jsonb,
      'Issued', 'John Storekeeper', '2026-08-28 17:00:00+00')
  ON CONFLICT (id) DO NOTHING;

  -- ── Additional cross-store transfers ──
  INSERT INTO public.uinv_transfers (id, property_id, transfer_number, from_store_id, to_store_id, lines, transfer_value, status, priority, dispatched_by, dispatched_at, reason) VALUES
    ('UINV-TX-003', prop_id, 'TX-2026-0003', 'UINV-ST-GEN',  'UINV-ST-HK',
      '[{"itemId":"UINV-IT-013","itemName":"Employee ID Card Blanks","quantity":50,"unit":"pcs","unitCost":2.80}]'::jsonb,
      140.00, 'Received', 'Normal', 'John Storekeeper', '2026-08-26 09:00:00+00', 'HR card stock to HK floor'),
    ('UINV-TX-004', prop_id, 'TX-2026-0004', 'UINV-ST-MAIN', 'UINV-ST-GEN',
      '[{"itemId":"UINV-IT-022","itemName":"A4 Paper Ream (500)","quantity":200,"unit":"ream","unitCost":4.00}]'::jsonb,
      800.00, 'Pending', 'Normal', NULL, NULL, 'Office paper replenishment')
  ON CONFLICT (id) DO NOTHING;

  -- ── Additional waste records (cross-department) ──
  INSERT INTO public.uinv_waste (id, property_id, waste_number, item_id, store_id, quantity, unit_cost, total_cost, waste_type, reason, department, status) VALUES
    ('UINV-WA-003', prop_id, 'WST-2026-0003', 'UINV-IT-018', 'UINV-ST-GEN',  20,  0.90, 18.00,  'Obsolete',  'Outdated edition',  'Concierge',        'Approved'),
    ('UINV-WA-004', prop_id, 'WST-2026-0004', 'UINV-IT-019', 'UINV-ST-GEN',  1,   28.00, 28.00, 'Spoilage',  'Opened & oxidized', 'Spa & Wellness',   'Pending'),
    ('UINV-WA-005', prop_id, 'WST-2026-0005', 'UINV-IT-016', 'UINV-ST-GEN',  10,  3.20, 32.00,  'Damage',    'Water damage',      'Sales',            'Draft')
  ON CONFLICT (id) DO NOTHING;

  -- ── Additional stock counts ──
  INSERT INTO public.uinv_counts (id, property_id, count_number, count_type, store_id, is_blind, lines, total_variance, status, started_at, completed_at) VALUES
    ('UINV-CN-003', prop_id, 'CNT-2026-0003', 'Cycle Count', 'UINV-ST-GEN', false,
      '[{"itemId":"UINV-IT-022","itemName":"A4 Paper Ream (500)","systemQty":500,"physicalQty":480,"variance":-20,"unitCost":4.00,"varianceValue":-80.00},{"itemId":"UINV-IT-015","itemName":"Office Stationery Pack","systemQty":180,"physicalQty":180,"variance":0,"unitCost":6.00,"varianceValue":0.00}]'::jsonb,
      -80.00, 'Completed', '2026-08-24 08:00:00+00', '2026-08-24 12:00:00+00'),
    ('UINV-CN-004', prop_id, 'CNT-2026-0004', 'Spot Count',  'UINV-ST-ENG', true,
      '[]'::jsonb, 0.00, 'In Progress', '2026-08-28 08:00:00+00', NULL)
  ON CONFLICT (id) DO NOTHING;

  -- ── Additional reservations (cross-department) ──
  INSERT INTO public.uinv_reservations (id, property_id, reservation_number, item_id, store_id, quantity, department, reference, required_date, expiry_date, status) VALUES
    ('UINV-RS-003', prop_id, 'RES-2026-0003', 'UINV-IT-020', 'UINV-ST-GEN', 40, 'Banquet & Events', 'BANQUET-EVT-003', '2026-08-31', '2026-09-02', 'Active'),
    ('UINV-RS-004', prop_id, 'RES-2026-0004', 'UINV-IT-014', 'UINV-ST-GEN', 4,  'Security',         'PATROL-SHIFT-3',  '2026-08-29', '2026-09-05', 'Active')
  ON CONFLICT (id) DO NOTHING;

  -- ── Additional stock ledger entries (cross-department movements) ──
  INSERT INTO public.uinv_stock_ledger (id, property_id, item_id, store_id, location_id, batch_id, transaction_type, reference, quantity_in, quantity_out, balance, unit_cost, value, performed_by, reason, transaction_date) VALUES
    ('UINV-LG-006', prop_id, 'UINV-IT-011', 'UINV-ST-GEN', 'UINV-LOC-GEN-1', NULL, 'Department Issue', 'ISS-2026-0004', 0, 100, 220, 4.50, 450.00, 'John Storekeeper', 'Issue to Front Office', '2026-08-28 08:30:00+00'),
    ('UINV-LG-007', prop_id, 'UINV-IT-013', 'UINV-ST-GEN', 'UINV-LOC-GEN-1', NULL, 'Department Issue', 'ISS-2026-0010', 0, 150, 390, 2.80, 420.00, 'John Storekeeper', 'Issue to Human Resources', '2026-08-26 10:00:00+00'),
    ('UINV-LG-008', prop_id, 'UINV-IT-022', 'UINV-ST-GEN', 'UINV-LOC-GEN-1', NULL, 'Count Adjustment', 'CNT-2026-0003', 0, 20, 480, 4.00, 80.00, 'System', 'Cycle count variance', '2026-08-24 12:00:00+00')
  ON CONFLICT (id) DO NOTHING;

  -- ── Additional replenishment requirements (cross-department) ──
  INSERT INTO public.uinv_replenishment (id, property_id, item_id, store_id, current_stock, reorder_point, par_level, suggested_qty, urgency, status) VALUES
    ('UINV-RP-004', prop_id, 'UINV-IT-012', 'UINV-ST-GEN', 8,   10,  20,  12,  'High',   'Open'),
    ('UINV-RP-005', prop_id, 'UINV-IT-014', 'UINV-ST-GEN', 12,  15,  30,  18,  'Normal', 'Open'),
    ('UINV-RP-006', prop_id, 'UINV-IT-019', 'UINV-ST-GEN', 18,  20,  50,  32,  'Normal', 'Open')
  ON CONFLICT (id) DO NOTHING;
END $$;
