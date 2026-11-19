-- ============================================================
-- Engineering Portal — Equipment Registry Seed (Migration 326)
-- ============================================================
-- Seeds the 4 mock equipment rows that were previously hardcoded
-- in EquipmentRegistry.tsx useState into the fixed_assets table.
--
-- The fixed_assets table itself comes from migration 080; the
-- engineering-specific columns (serial_number, manufacturer,
-- model_number, warranty_start, warranty_end, warranty_provider,
-- criticality, parent_asset_id, property_id) were added by earlier
-- migrations applied to the live DB.
--
-- This migration only inserts seed rows. It is idempotent — safe to
-- re-run. Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703)
-- for multi-property scoping.
-- ============================================================

INSERT INTO fixed_assets (
  asset_code, asset_name, asset_category, description, location,
  purchase_date, purchase_cost, salvage_value, useful_life_years,
  depreciation_method, net_book_value, status,
  serial_number, manufacturer, model_number,
  warranty_start, warranty_end, warranty_provider, criticality,
  property_id
) VALUES
(
  'GEN-01', 'Backup Generator 500kVA', 'Power Systems',
  '500 kVA backup generator for emergency power. 400V, 720A output.',
  'Plant Room 1',
  '2022-03-15', 85000.00, 5000.00, 15,
  'Straight Line', 80000.00, 'Active',
  'CUM-2022-GEN-001', 'Cummins Power', 'C500D5',
  '2022-03-15', '2027-03-15', 'Cummins Power Systems', 'High',
  '18762279-a389-41c9-9169-7ebc682e9703'
),
(
  'AC-LOBBY-01', 'Central Chiller Unit', 'HVAC',
  '1200 kW central chiller unit for lobby and common areas. 380V 3-phase.',
  'Rooftop South',
  '2023-01-20', 120000.00, 8000.00, 12,
  'Straight Line', 112000.00, 'Under Maintenance',
  'DAI-2023-AC-001', 'Daikin Industries', 'VRV IV',
  '2023-01-20', '2028-01-20', 'Daikin Middle East', 'High',
  '18762279-a389-41c9-9169-7ebc682e9703'
),
(
  'EV-A', 'Service Elevator Alpha', 'Vertical Transport',
  '1000 kg service elevator for back-of-house operations. 15 kW motor.',
  'Back of House',
  '2022-11-10', 95000.00, 3000.00, 20,
  'Straight Line', 92000.00, 'Active',
  'OTI-2022-EV-A', 'Otis Worldwide', 'Gen2',
  '2022-11-10', '2032-11-10', 'Otis Ethiopia', 'Critical',
  '18762279-a389-41c9-9169-7ebc682e9703'
),
(
  'BOILER-02', 'Steam Boiler 02', 'HVAC',
  '2000 kg/h steam boiler. 1500 kW. Pressure vessel certified.',
  'Boiler Room',
  '2021-08-01', 65000.00, 2000.00, 15,
  'Straight Line', 63000.00, 'Active',
  'BOS-2021-BOILER-02', 'Bosch', 'Uni 3000 T',
  '2021-08-01', '2024-08-01', 'Bosch Thermotechnology', 'High',
  '18762279-a389-41c9-9169-7ebc682e9703'
)
ON CONFLICT (asset_code) DO NOTHING;
