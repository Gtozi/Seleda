-- 563 — Revenue Management department store + inventory items
--
-- Mirrors the Spa & Wellness inventory setup (488_spa_inventory_store.sql):
-- a dedicated department store (UINV-ST-RMS, department='Revenue Management')
-- under the Main Warehouse so the unified inventory portal resolves it via
-- resolveDepartmentStoreIds() (department column), plus a seed set of office
-- consumables with opening stock balances.
--
-- Powers the Revenue Management "Requisitions" and "Replenishment" tabs,
-- which embed the shared DepartmentRequisitionForm /
-- DepartmentReplenishmentPanel components (same as other portals).

DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Revenue Management department store
  INSERT INTO public.uinv_stores (id, property_id, store_code, store_name, store_type, parent_store_id, manager, location, capacity, temperature_zone, is_active, department) VALUES
    ('UINV-ST-RMS', prop_id, 'RMS', 'Revenue Management Store', 'Warehouse', 'UINV-ST-MAIN', 'Revenue Manager', 'Executive Offices', 2000, 'Ambient', true, 'Revenue Management')
  ON CONFLICT (id) DO NOTHING;

  -- Locations inside the RMS store
  INSERT INTO public.uinv_locations (id, store_id, location_code, location_name, location_type, temperature_zone, is_active) VALUES
    ('UINV-LOC-RMS-1', 'UINV-ST-RMS', 'RMS-1', 'RMS Shelf 1', 'Shelf', 'Ambient', true),
    ('UINV-LOC-RMS-2', 'UINV-ST-RMS', 'RMS-2', 'RMS Shelf 2', 'Shelf', 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;

  -- Revenue Management items — office/admin consumables matching the
  -- 'Revenue Management' entry in DEPARTMENT_CATEGORIES
  -- (Office Supplies / Administration / Operating Supplies).
  INSERT INTO public.uinv_items (id, property_id, item_code, item_name, description, category, subcategory, item_type, brand, unit_of_measure, batch_controlled, expiry_controlled, fefo_required, min_stock, max_stock, reorder_point, safety_stock, par_level, default_store_id, costing_method, last_cost, avg_cost, standard_cost, is_active) VALUES
    ('UINV-IT-RMS-001', prop_id, 'RMS-101', 'A4 Printer Paper (Ream)',        '80gsm A4 copy paper, 500 sheets',        'Office Supplies',    'Paper & Printing',  'Consumable', 'OfficePro',   'ream',   false, false, false, 20, 200, 30, 10, 60,  'UINV-ST-RMS', 'Weighted Average', 6.50,  6.50,  6.20,  true),
    ('UINV-IT-RMS-002', prop_id, 'RMS-102', 'Printer Toner Cartridge',        'Laser toner cartridge (black)',          'Office Supplies',    'Paper & Printing',  'Consumable', 'PrintMax',    'pcs',    false, false, false, 4,  30,  8,  2,  15,  'UINV-ST-RMS', 'Weighted Average', 48.00, 48.00, 46.00, true),
    ('UINV-IT-RMS-003', prop_id, 'RMS-103', 'Ballpoint Pens (Box of 50)',     'Blue ballpoint pens',                    'Office Supplies',    'Writing Instruments','Consumable','WriteWell',   'box',    false, false, false, 5,  40,  10, 3,  20,  'UINV-ST-RMS', 'Weighted Average', 12.00, 12.00, 11.50, true),
    ('UINV-IT-RMS-004', prop_id, 'RMS-104', 'Notepads (Pack of 10)',          'A5 ruled notepads',                      'Office Supplies',    'Paper & Printing',  'Consumable', 'OfficePro',   'pack',   false, false, false, 6,  50,  12, 4,  25,  'UINV-ST-RMS', 'Weighted Average', 9.00,  9.00,  8.50,  true),
    ('UINV-IT-RMS-005', prop_id, 'RMS-105', 'Whiteboard Markers (Pack of 12)','Dry-erase markers, assorted colors',     'Office Supplies',    'Writing Instruments','Consumable','BoardMate',   'pack',   false, false, false, 4,  30,  8,  2,  15,  'UINV-ST-RMS', 'Weighted Average', 14.00, 14.00, 13.50, true),
    ('UINV-IT-RMS-006', prop_id, 'RMS-106', 'USB Flash Drive 64GB',           'USB 3.0 flash drive for report exports', 'Office Supplies',    'IT Accessories',    'Consumable', 'DataKey',     'pcs',    false, false, false, 5,  40,  10, 3,  20,  'UINV-ST-RMS', 'Weighted Average', 11.00, 11.00, 10.50, true),
    ('UINV-IT-RMS-007', prop_id, 'RMS-107', 'Report Binding Covers',          'Clear A4 binding covers (pack of 100)',  'Office Supplies',    'Paper & Printing',  'Consumable', 'BindRight',   'pack',   false, false, false, 3,  20,  6,  2,  10,  'UINV-ST-RMS', 'Weighted Average', 16.50, 16.50, 16.00, true),
    ('UINV-IT-RMS-008', prop_id, 'RMS-108', 'Desk Organizer Tray',            '3-tier document tray for rate reports',  'Operating Supplies', 'Office Equipment',  'Consumable', 'DeskLine',    'pcs',    false, false, false, 2,  15,  4,  1,  8,   'UINV-ST-RMS', 'Weighted Average', 19.00, 19.00, 18.00, true)
  ON CONFLICT (id) DO NOTHING;

  -- Opening stock balances at the RMS store.
  -- A4 paper and toner start below reorder_point so the first
  -- "Auto-Calculate Requests" produces draft replenishment requests.
  INSERT INTO public.uinv_stock_balances (id, property_id, item_id, store_id, location_id, on_hand, reserved, allocated, on_order, in_transit, damaged, quarantined, expired, status, unit_cost, last_movement_date) VALUES
    ('UINV-SB-RMS-001', prop_id, 'UINV-IT-RMS-001', 'UINV-ST-RMS', NULL, 14,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 6.50,  now() - interval '3 days'),
    ('UINV-SB-RMS-002', prop_id, 'UINV-IT-RMS-002', 'UINV-ST-RMS', NULL, 5,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 48.00, now() - interval '7 days'),
    ('UINV-SB-RMS-003', prop_id, 'UINV-IT-RMS-003', 'UINV-ST-RMS', NULL, 22,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 12.00, now() - interval '5 days'),
    ('UINV-SB-RMS-004', prop_id, 'UINV-IT-RMS-004', 'UINV-ST-RMS', NULL, 18,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 9.00,  now() - interval '5 days'),
    ('UINV-SB-RMS-005', prop_id, 'UINV-IT-RMS-005', 'UINV-ST-RMS', NULL, 12,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 14.00, now() - interval '2 days'),
    ('UINV-SB-RMS-006', prop_id, 'UINV-IT-RMS-006', 'UINV-ST-RMS', NULL, 16,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 11.00, now() - interval '4 days'),
    ('UINV-SB-RMS-007', prop_id, 'UINV-IT-RMS-007', 'UINV-ST-RMS', NULL, 8,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 16.50, now() - interval '6 days'),
    ('UINV-SB-RMS-008', prop_id, 'UINV-IT-RMS-008', 'UINV-ST-RMS', NULL, 9,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 19.00, now() - interval '10 days')
  ON CONFLICT (id) DO NOTHING;
END $$;
