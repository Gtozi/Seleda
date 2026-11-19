-- 325_eng_pm_schedules_seed.sql
-- Engineering Portal — Preventive Maintenance Scheduler seed.
-- Backs the /erp/maintenance/pm tab (PreventiveMaintenanceScheduler.tsx).
--
-- The pm_schedules table already exists (migration 114). This migration seeds
-- the mock PM schedules that give the tab data on a fresh DB. Each schedule
-- includes a checklist_template so the auto-generated work orders carry
-- actionable checklists.
--
-- The fixed_assets table is empty on a fresh DB, so asset_id is left NULL.
-- The demo property (18762279-a389-41c9-9169-7ebc682e9703) is used for
-- multi-property scoping via the property_id column (added in a prior
-- migration).

INSERT INTO public.pm_schedules
  (id, schedule_name, asset_id, frequency, interval_days, next_due_date,
   last_completed_date, checklist_template, assigned_technician, priority,
   status, property_id)
VALUES
  ('PM-1001', 'Monthly Generator Inspection', NULL, 'Monthly', 30,
   '2026-08-15', '2026-07-15',
   '[{"id":"CL-1","description":"Check fuel level and top up if needed"},{"id":"CL-2","description":"Inspect battery and terminals"},{"id":"CL-3","description":"Test auto-transfer switch"},{"id":"CL-4","description":"Run generator under load for 30 min"},{"id":"CL-5","description":"Record operating parameters"}]'::jsonb,
   'John Electrician', 'High', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('PM-1002', 'Quarterly HVAC Filter Replacement', NULL, 'Quarterly', 90,
   '2026-08-01', '2026-05-01',
   '[{"id":"CL-1","description":"Replace all AHU filters"},{"id":"CL-2","description":"Clean condenser coils"},{"id":"CL-3","description":"Check refrigerant pressures"},{"id":"CL-4","description":"Inspect and lubricate fan motors"},{"id":"CL-5","description":"Verify thermostat operation"}]'::jsonb,
   'Maria HVAC', 'Medium', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('PM-1003', 'Weekly Fire Pump Test', NULL, 'Weekly', 7,
   '2026-08-05', '2026-07-29',
   '[{"id":"CL-1","description":"Run fire pump for 10 minutes"},{"id":"CL-2","description":"Check pressure gauge readings"},{"id":"CL-3","description":"Inspect packing gland for leaks"},{"id":"CL-4","description":"Verify jockey pump operation"},{"id":"CL-5","description":"Log test results in fire log"}]'::jsonb,
   'David Mechanic', 'High', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('PM-1004', 'Monthly Elevator Inspection', NULL, 'Monthly', 30,
   '2026-08-20', '2026-07-20',
   '[{"id":"CL-1","description":"Test door sensors on all floors"},{"id":"CL-2","description":"Inspect cables and sheaves"},{"id":"CL-3","description":"Check emergency phone operation"},{"id":"CL-4","description":"Test emergency stop and alarm"},{"id":"CL-5","description":"Lubricate guide rails"}]'::jsonb,
   'External Contractor', 'Medium', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('PM-1005', 'Annual Boiler Maintenance', NULL, 'Annual', 365,
   '2026-09-01', '2025-09-01',
   '[{"id":"CL-1","description":"Inspect and clean burners"},{"id":"CL-2","description":"Replace fuel filters"},{"id":"CL-3","description":"Check combustion efficiency"},{"id":"CL-4","description":"Test safety valves and controls"},{"id":"CL-5","description":"Inspect refractory and replace damaged sections"},{"id":"CL-6","description":"Water treatment system check"}]'::jsonb,
   'Maria HVAC', 'High', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('PM-1006', 'Monthly Water Heater Flush', NULL, 'Monthly', 30,
   '2026-08-10', '2026-07-10',
   '[{"id":"CL-1","description":"Flush water heater tank to remove sediment"},{"id":"CL-2","description":"Inspect anode rod"},{"id":"CL-3","description":"Check T&P valve operation"},{"id":"CL-4","description":"Verify temperature setting (140F)"}]'::jsonb,
   'Carlos Plumber', 'Low', 'Active', '18762279-a389-41c9-9169-7ebc682e9703'),
  ('PM-1007', 'Quarterly Electrical Panel Inspection', NULL, 'Quarterly', 90,
   '2026-08-25', '2026-05-25',
   '[{"id":"CL-1","description":"Thermal scan all main panels"},{"id":"CL-2","description":"Tighten all connections"},{"id":"CL-3","description":"Check for arc marks or discoloration"},{"id":"CL-4","description":"Test GFCI and AFCI breakers"},{"id":"CL-5","description":"Verify labeling and panel schedules"}]'::jsonb,
   'John Electrician', 'Medium', 'Active', '18762279-a389-41c9-9169-7ebc682e9703')
ON CONFLICT (id) DO NOTHING;
