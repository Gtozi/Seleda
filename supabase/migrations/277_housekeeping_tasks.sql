-- Migration: Housekeeping Task Management
-- Adds the housekeeping_task_mgmt table backing the Task Management module
-- (docs/Housekeeping Portal new.md §6) and seeds the 13 mock tasks that
-- were previously hardcoded in TaskManagementModule.tsx (seedTasks).
--
-- A separate table from the legacy housekeeping_tasks (which models
-- room-bound scheduled jobs with a room_id FK). This table models the
-- module's Task contract exactly:
--   id, type, category, location, assignedTo, priority, dueDate, status, progress
-- Status/priority/type/category use the display-case enums the UI renders.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housekeeping_task_mgmt (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
                  'Checkout Cleaning', 'Stayover Service', 'VIP Preparation',
                  'Turndown Service', 'Early Arrival Preparation', 'Deep Cleaning',
                  'Preventive Cleaning', 'Public Area Cleaning', 'Special Cleaning',
                  'Emergency Cleaning', 'Biohazard Cleaning', 'Room Refresh',
                  'Guest Complaint Follow-up'
                )),
  category      TEXT NOT NULL CHECK (category IN ('Automatic', 'Manual')),
  location      TEXT NOT NULL,
  assigned_to   TEXT,
  priority      TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN (
                  'Low', 'Medium', 'High', 'Critical'
                )),
  due_date      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (
                  'Pending', 'In Progress', 'Completed', 'Verified'
                )),
  progress      INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_task_mgmt_property
  ON housekeeping_task_mgmt(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_task_mgmt_status
  ON housekeeping_task_mgmt(status);
CREATE INDEX IF NOT EXISTS idx_hk_task_mgmt_category
  ON housekeeping_task_mgmt(category);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_task_mgmt_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_task_mgmt_updated_at ON housekeeping_task_mgmt;
CREATE TRIGGER trigger_hk_task_mgmt_updated_at
  BEFORE UPDATE ON housekeeping_task_mgmt
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_task_mgmt_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON housekeeping_task_mgmt TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 13 tasks (8 Automatic + 5 Manual) previously hardcoded as seedTasks
-- in TaskManagementModule.tsx. Uses the single demo property.
INSERT INTO housekeeping_task_mgmt
  (id, property_id, type, category, location, assigned_to, priority, due_date, status, progress)
VALUES
  ('TSK-3001', '18762279-a389-41c9-9169-7ebc682e9703', 'Checkout Cleaning',            'Automatic', 'Room 101', 'Maria S.',  'High',     '2026-08-20 09:00', 'In Progress', 60),
  ('TSK-3002', '18762279-a389-41c9-9169-7ebc682e9703', 'Stayover Service',             'Automatic', 'Room 204', 'James L.',  'Medium',   '2026-08-20 10:30', 'Pending',     0),
  ('TSK-3003', '18762279-a389-41c9-9169-7ebc682e9703', 'VIP Preparation',              'Automatic', 'Room 502', 'Priya K.',  'Critical', '2026-08-20 14:00', 'Pending',     0),
  ('TSK-3004', '18762279-a389-41c9-9169-7ebc682e9703', 'Turndown Service',             'Automatic', 'Room 305', 'Carlos M.', 'Medium',   '2026-08-20 19:00', 'Pending',     0),
  ('TSK-3005', '18762279-a389-41c9-9169-7ebc682e9703', 'Early Arrival Preparation',    'Automatic', 'Room 410', NULL,         'High',     '2026-08-20 11:00', 'Completed',   100),
  ('TSK-3006', '18762279-a389-41c9-9169-7ebc682e9703', 'Deep Cleaning',                'Automatic', 'Room 401', 'Aisha B.',  'Low',      '2026-08-21 08:00', 'Pending',     0),
  ('TSK-3007', '18762279-a389-41c9-9169-7ebc682e9703', 'Preventive Cleaning',          'Automatic', 'Room 306', NULL,         'Low',      '2026-08-22 08:00', 'Pending',     0),
  ('TSK-3008', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning',         'Automatic', 'Lobby',    'Maria S.',  'High',     '2026-08-20 07:00', 'Completed',   100),
  ('TSK-3009', '18762279-a389-41c9-9169-7ebc682e9703', 'Special Cleaning',             'Manual',    'Room 220', 'James L.',  'Medium',   '2026-08-20 13:00', 'In Progress', 40),
  ('TSK-3010', '18762279-a389-41c9-9169-7ebc682e9703', 'Emergency Cleaning',           'Manual',    'Room 118', 'Priya K.',  'Critical', '2026-08-20 08:30', 'In Progress', 80),
  ('TSK-3011', '18762279-a389-41c9-9169-7ebc682e9703', 'Biohazard Cleaning',           'Manual',    'Room 309', NULL,         'Critical', '2026-08-20 09:00', 'Pending',     0),
  ('TSK-3012', '18762279-a389-41c9-9169-7ebc682e9703', 'Room Refresh',                 'Manual',    'Room 412', 'Carlos M.', 'Low',      '2026-08-20 15:00', 'Pending',     0),
  ('TSK-3013', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Complaint Follow-up',    'Manual',    'Room 207', 'Aisha B.',  'High',     '2026-08-20 12:00', 'Verified',    100)
ON CONFLICT (id) DO NOTHING;
