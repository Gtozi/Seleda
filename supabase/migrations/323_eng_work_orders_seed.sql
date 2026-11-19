-- 323_eng_work_orders_seed.sql
-- Seeds the 6 mock work orders that were previously hardcoded as useState
-- initial state in WorkOrderManagement.tsx. The work_orders table already
-- exists (migration 114 / 000_baseline.sql); this only inserts seed rows
-- so the Work Order Management console has data on a fresh DB.

INSERT INTO work_orders
  (id, wo_number, title, description, type, priority, status, assigned_to,
   room_number, scheduled_date, started_at, completed_at, labor_hours,
   actual_cost, notes, created_by, created_date)
VALUES
  ('WO-1024', 'WO-2026-001', 'Water leak under bathroom sink',
   'Water leak detected under bathroom sink. Guest reported dripping sounds.',
   'Plumbing', 'High', 'In Progress', 'Plumbing Team', '101', '2026-07-29',
   '2026-07-29 08:45+00', NULL, 2.5, 150, NULL, 'system',
   '2026-07-29 08:30+00'),
  ('WO-1025', 'WO-2026-002', 'Power outage in lobby reception',
   'Power outage in lobby reception area. All front desk terminals offline.',
   'Electrical', 'Emergency', 'Assigned', 'Electrical Team', NULL,
   '2026-07-29', NULL, NULL, 0, 0, NULL, 'system',
   '2026-07-29 09:15+00'),
  ('WO-1026', 'WO-2026-003', 'Cold room door seal damaged',
   'Cold room door seal damaged. Losing temperature efficiency.',
   'Kitchen Equipment', 'Normal', 'Waiting for Parts',
   'General Maintenance Team', NULL, '2026-07-28', NULL, NULL, 3, 280, NULL,
   'system', '2026-07-28 16:45+00'),
  ('WO-1027', 'WO-2026-004', 'Pool filter backwash',
   'Filter backwash required as per weekly schedule.',
   'Plumbing', 'Low', 'Completed', 'Plumbing Team', NULL, '2026-07-28',
   '2026-07-28 14:30+00', '2026-07-28 15:15+00', 1.5, 75,
   'Backwash completed successfully. Filter pressure normalized.', 'system',
   '2026-07-28 14:00+00'),
  ('WO-1028', 'WO-2026-005', 'AC unit not cooling - Room 205',
   'AC unit not cooling properly. Guest complaining about room temperature.',
   'HVAC', 'High', 'Waiting for Vendor', 'HVAC Team', '205', '2026-07-28',
   NULL, NULL, 2, 320, NULL, 'system', '2026-07-28 10:30+00'),
  ('WO-1029', 'WO-2026-006', 'Parking lot light pole #3 not functioning',
   'Parking lot light pole #3 not functioning. Safety concern.',
   'Electrical', 'Normal', 'Verified', 'Electrical Team', NULL, '2026-07-27',
   '2026-07-27 16:50+00', '2026-07-27 17:30+00', 1, 85,
   'Replaced LED bulb. Light functioning. Verified by security team.',
   'system', '2026-07-27 16:20+00')
ON CONFLICT (id) DO NOTHING;
