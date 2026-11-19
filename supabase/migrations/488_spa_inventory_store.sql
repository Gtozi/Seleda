-- 488 — Spa & Wellness department store + inventory items
--
-- Mirrors the Housekeeping inventory setup: a dedicated department store
-- (UINV-ST-SPA, department='Spa & Wellness') under the Main Warehouse so
-- the unified inventory portal resolves it via resolveDepartmentStoreIds()
-- (department column), plus a seed set of spa consumables with opening
-- stock balances.

DO $$
DECLARE prop_id uuid := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  -- Spa & Wellness department store
  INSERT INTO public.uinv_stores (id, property_id, store_code, store_name, store_type, parent_store_id, manager, location, capacity, temperature_zone, is_active, department) VALUES
    ('UINV-ST-SPA', prop_id, 'SPA', 'Spa & Wellness Store', 'Warehouse', 'UINV-ST-MAIN', 'Spa Director', 'Spa Block', 6000, 'Ambient', true, 'Spa & Wellness')
  ON CONFLICT (id) DO NOTHING;

  -- Locations inside the spa store
  INSERT INTO public.uinv_locations (id, store_id, location_code, location_name, location_type, temperature_zone, is_active) VALUES
    ('UINV-LOC-SPA-1', 'UINV-ST-SPA', 'SPA-1', 'Spa Shelf 1', 'Shelf', 'Ambient', true),
    ('UINV-LOC-SPA-2', 'UINV-ST-SPA', 'SPA-2', 'Spa Shelf 2', 'Shelf', 'Ambient', true)
  ON CONFLICT (id) DO NOTHING;

  -- Spa inventory items (category 'Spa & Wellness' matches the existing
  -- convention used by UINV-IT-019 and the uinv_items category list).
  INSERT INTO public.uinv_items (id, property_id, item_code, item_name, description, category, subcategory, item_type, brand, unit_of_measure, batch_controlled, expiry_controlled, fefo_required, min_stock, max_stock, reorder_point, safety_stock, par_level, default_store_id, costing_method, last_cost, avg_cost, standard_cost, is_active) VALUES
    ('UINV-IT-SPA-001', prop_id, 'SPA-101', 'Massage Oil - Lavender 500ml',  'Professional lavender massage oil',        'Spa & Wellness', 'Massage Oils & Lotions', 'Consumable', 'AromaSpa',    'bottle', false, true,  false, 20, 300, 40, 10, 80,  'UINV-ST-SPA', 'Weighted Average', 14.50, 14.50, 14.00, true),
    ('UINV-IT-SPA-002', prop_id, 'SPA-102', 'Massage Oil - Eucalyptus 500ml','Professional eucalyptus massage oil',     'Spa & Wellness', 'Massage Oils & Lotions', 'Consumable', 'AromaSpa',    'bottle', false, true,  false, 20, 300, 40, 10, 80,  'UINV-ST-SPA', 'Weighted Average', 14.50, 14.50, 14.00, true),
    ('UINV-IT-SPA-003', prop_id, 'SPA-103', 'Facial Cleanser 200ml',        'Gentle facial cleanser for treatments',    'Spa & Wellness', 'Facial Products',       'Consumable', 'DermaPure',   'bottle', false, true,  false, 15, 200, 30, 8,  60,  'UINV-ST-SPA', 'Weighted Average', 22.00, 22.00, 21.00, true),
    ('UINV-IT-SPA-004', prop_id, 'SPA-104', 'Clay Body Mask 1kg',           'Detoxifying clay body wrap mask',          'Spa & Wellness', 'Body Treatments',       'Consumable', 'TerraSpa',    'kg',     false, true,  false, 8,  100, 15, 4,  30,  'UINV-ST-SPA', 'Weighted Average', 38.00, 38.00, 37.00, true),
    ('UINV-IT-SPA-005', prop_id, 'SPA-105', 'Sea Salt Scrub 1kg',           'Exfoliating sea salt body scrub',          'Spa & Wellness', 'Body Treatments',       'Consumable', 'TerraSpa',    'kg',     false, true,  false, 8,  100, 15, 4,  30,  'UINV-ST-SPA', 'Weighted Average', 32.00, 32.00, 31.00, true),
    ('UINV-IT-SPA-006', prop_id, 'SPA-106', 'Spa Towel - Large',            'Large white spa towel',                    'Spa & Wellness', 'Towels & Linens',       'Consumable', 'SoftThread',  'pcs',    false, false, false, 60, 500, 100,20, 150, 'UINV-ST-SPA', 'Weighted Average', 9.50,  9.50,  9.00,  true),
    ('UINV-IT-SPA-007', prop_id, 'SPA-107', 'Spa Towel - Hand',             'Hand-size white spa towel',                'Spa & Wellness', 'Towels & Linens',       'Consumable', 'SoftThread',  'pcs',    false, false, false, 80, 600, 120,25, 200, 'UINV-ST-SPA', 'Weighted Average', 4.20,  4.20,  4.00,  true),
    ('UINV-IT-SPA-008', prop_id, 'SPA-108', 'Disposable Spa Slippers',      'Single-use guest slippers (pair)',         'Spa & Wellness', 'Guest Amenities',       'Consumable', 'ComfortStep', 'pair',   false, false, false, 100,800, 150,30, 250, 'UINV-ST-SPA', 'Weighted Average', 1.80,  1.80,  1.70,  true),
    ('UINV-IT-SPA-009', prop_id, 'SPA-109', 'Essential Oil Diffuser Refill','Calming blend diffuser refill 100ml',      'Spa & Wellness', 'Aromatherapy',          'Consumable', 'AromaSpa',    'bottle', false, true,  false, 10, 120, 20, 5,  40,  'UINV-ST-SPA', 'Weighted Average', 18.00, 18.00, 17.50, true),
    ('UINV-IT-SPA-010', prop_id, 'SPA-110', 'Hot Stone Set (16pc)',         'Basalt hot stone massage set',             'Spa & Wellness', 'Equipment',             'Consumable', 'ThermaStone', 'set',    false, false, false, 2,  12,  4,  1,  6,   'UINV-ST-SPA', 'Weighted Average', 120.00,120.00,118.00,true),
    ('UINV-IT-SPA-011', prop_id, 'SPA-111', 'Disposable Headrest Covers',   'Face cradle covers (box of 100)',          'Spa & Wellness', 'Guest Amenities',       'Consumable', 'ComfortStep', 'box',    false, false, false, 10, 80,  20, 5,  30,  'UINV-ST-SPA', 'Weighted Average', 12.00, 12.00, 11.50, true),
    ('UINV-IT-SPA-012', prop_id, 'SPA-112', 'Herbal Tea Assortment',        'Post-treatment herbal tea (box of 50)',    'Spa & Wellness', 'Guest Amenities',       'Consumable', 'ZenLeaf',     'box',    false, true,  false, 12, 100, 25, 6,  40,  'UINV-ST-SPA', 'Weighted Average', 15.00, 15.00, 14.50, true)
  ON CONFLICT (id) DO NOTHING;

  -- Point the pre-existing spa item at the spa store too
  UPDATE public.uinv_items SET default_store_id = 'UINV-ST-SPA'
  WHERE id = 'UINV-IT-019' AND default_store_id IS DISTINCT FROM 'UINV-ST-SPA';

  -- Opening stock balances at the spa store
  INSERT INTO public.uinv_stock_balances (id, property_id, item_id, store_id, location_id, on_hand, reserved, allocated, on_order, in_transit, damaged, quarantined, expired, status, unit_cost, last_movement_date) VALUES
    ('UINV-SB-SPA-001', prop_id, 'UINV-IT-SPA-001', 'UINV-ST-SPA', NULL, 95,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 14.50, now() - interval '6 days'),
    ('UINV-SB-SPA-002', prop_id, 'UINV-IT-SPA-002', 'UINV-ST-SPA', NULL, 78,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 14.50, now() - interval '6 days'),
    ('UINV-SB-SPA-003', prop_id, 'UINV-IT-SPA-003', 'UINV-ST-SPA', NULL, 54,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 22.00, now() - interval '4 days'),
    ('UINV-SB-SPA-004', prop_id, 'UINV-IT-SPA-004', 'UINV-ST-SPA', NULL, 26,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 38.00, now() - interval '9 days'),
    ('UINV-SB-SPA-005', prop_id, 'UINV-IT-SPA-005', 'UINV-ST-SPA', NULL, 22,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 32.00, now() - interval '9 days'),
    ('UINV-SB-SPA-006', prop_id, 'UINV-IT-SPA-006', 'UINV-ST-SPA', NULL, 210, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 9.50,  now() - interval '2 days'),
    ('UINV-SB-SPA-007', prop_id, 'UINV-IT-SPA-007', 'UINV-ST-SPA', NULL, 260, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 4.20,  now() - interval '2 days'),
    ('UINV-SB-SPA-008', prop_id, 'UINV-IT-SPA-008', 'UINV-ST-SPA', NULL, 320, 0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 1.80,  now() - interval '3 days'),
    ('UINV-SB-SPA-009', prop_id, 'UINV-IT-SPA-009', 'UINV-ST-SPA', NULL, 18,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 18.00, now() - interval '5 days'),
    ('UINV-SB-SPA-010', prop_id, 'UINV-IT-SPA-010', 'UINV-ST-SPA', NULL, 5,   0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 120.00,now() - interval '20 days'),
    ('UINV-SB-SPA-011', prop_id, 'UINV-IT-SPA-011', 'UINV-ST-SPA', NULL, 42,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 12.00, now() - interval '3 days'),
    ('UINV-SB-SPA-012', prop_id, 'UINV-IT-SPA-012', 'UINV-ST-SPA', NULL, 36,  0, 0, 0, 0, 0, 0, 0, 'Available'::public.uinv_stock_status, 15.00, now() - interval '1 day')
  ON CONFLICT (id) DO NOTHING;

  -- Balance for the legacy aromatherapy oil at the spa store (if one does
  -- not already exist for that item+store+null-location combination)
  INSERT INTO public.uinv_stock_balances (id, property_id, item_id, store_id, location_id, on_hand, unit_cost, status, last_movement_date)
  SELECT 'UINV-SB-SPA-019', prop_id, 'UINV-IT-019', 'UINV-ST-SPA', NULL, 40, 18.00, 'Available'::public.uinv_stock_status, now() - interval '4 days'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.uinv_stock_balances
    WHERE item_id = 'UINV-IT-019' AND store_id = 'UINV-ST-SPA' AND location_id IS NULL
  );
END $$;
