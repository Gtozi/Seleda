-- 347_proc_demand_forecasts_seed.sql
-- Seeds the proc_demand_forecasts table with mock demand forecast rows so the
-- /erp/procurement/demand-planning and /erp/procurement/procurement-planning tabs
-- have data on a fresh DB. The table itself comes from migration 345.
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703) for multi-property scoping.

INSERT INTO public.proc_demand_forecasts
  (id, property_id, department, category, forecast_date, forecast_quantity, unit_of_measure, confidence_level, forecast_source, notes)
VALUES
  ('df-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Food & Beverage', 'Food', CURRENT_DATE + INTERVAL '7 days',  250.000, 'KG',  'High',   'Occupancy Forecast', 'Weekly F&B demand based on 80% occupancy forecast'),
  ('df-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Food & Beverage', 'Beverage', CURRENT_DATE + INTERVAL '7 days', 120.000, 'L',   'Medium', 'Historical',         'Beverage demand from last 3 months trend'),
  ('df-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Housekeeping',     'Linen', CURRENT_DATE + INTERVAL '14 days', 80.000, 'PCS', 'High',   'Historical',         'Linen replacement cycle demand'),
  ('df-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Housekeeping',     'Amenities', CURRENT_DATE + INTERVAL '14 days', 500.000, 'PCS', 'Medium', 'Occupancy Forecast', 'Guest amenities per occupied room'),
  ('df-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Engineering',      'Maintenance', CURRENT_DATE + INTERVAL '30 days', 15.000, 'PCS', 'Low',    'Manual',              'Preventive maintenance spare parts'),
  ('df-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Administration',   'Office Supplies', CURRENT_DATE + INTERVAL '30 days', 30.000, 'BOX', 'Medium', 'Historical',         'Monthly office supplies consumption'),
  ('df-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Food & Beverage', 'Food', CURRENT_DATE + INTERVAL '30 days', 950.000, 'KG',  'Medium', 'Historical',         'Monthly food demand projection'),
  ('df-008', '18762279-a389-41c9-9169-7ebc682e9703', 'Food & Beverage', 'Beverage', CURRENT_DATE + INTERVAL '30 days', 480.000, 'L',   'Medium', 'Historical',         'Monthly beverage demand projection'),
  ('df-009', '18762279-a389-41c9-9169-7ebc682e9703', 'Housekeeping',     'Cleaning Supplies', CURRENT_DATE + INTERVAL '30 days', 60.000, 'L',   'High',   'Historical',         'Monthly cleaning supplies demand'),
  ('df-010', '18762279-a389-41c9-9169-7ebc682e9703', 'Engineering',      'Utilities', CURRENT_DATE + INTERVAL '30 days', 200.000, 'KWH','Low',    'Manual',              'Energy consumption forecast')
ON CONFLICT (id) DO NOTHING;
