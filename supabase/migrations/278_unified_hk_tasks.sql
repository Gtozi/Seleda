-- Migration: Unified Housekeeping Tasks
-- Consolidates Room Cleaning (§7) and Public Area Cleaning (§8) into the
-- Task Management (§6) table. The housekeeping_task_mgmt table is extended
-- with nullable columns that previously only existed on
-- housekeeping_cleaning_jobs, then existing cleaning jobs are migrated.
--
-- After this migration:
--   - housekeeping_task_mgmt is the single source of truth for all HK tasks
--   - housekeeping_cleaning_jobs is kept for data safety but no longer used
--   - The Room Cleaning and Public Area Cleaning frontend modules are removed
--   - The interactive checklist is driven by getChecklistForType() on the
--     client, so the checklist JSONB is a free-form Record<string, boolean>

-- ── 1. Extend housekeeping_task_mgmt ──────────────────────────────────────

ALTER TABLE housekeeping_task_mgmt
  ADD COLUMN IF NOT EXISTS attendant_id  TEXT,
  ADD COLUMN IF NOT EXISTS service_type  TEXT,
  ADD COLUMN IF NOT EXISTS floor         TEXT,
  ADD COLUMN IF NOT EXISTS checklist     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at    TEXT,
  ADD COLUMN IF NOT EXISTS completed_at  TEXT,
  ADD COLUMN IF NOT EXISTS notes         TEXT,
  ADD COLUMN IF NOT EXISTS frequency     TEXT,
  ADD COLUMN IF NOT EXISTS last_cleaned  TEXT;

-- Index the new filterable columns
CREATE INDEX IF NOT EXISTS idx_hk_task_mgmt_service_type
  ON housekeeping_task_mgmt(service_type);
CREATE INDEX IF NOT EXISTS idx_hk_task_mgmt_floor
  ON housekeeping_task_mgmt(floor);

-- ── 2. Migrate existing cleaning jobs into task_mgmt ──────────────────────
-- Maps each service_type to the closest task type:
--   Full Service      → Checkout Cleaning
--   Stayover Service  → Stayover Service
--   Express Service   → Early Arrival Preparation
--   Eco Service       → Stayover Service
--   Turndown Service  → Turndown Service
-- The original service_type is preserved in the service_type column so the
-- unified UI can still filter / display it.

INSERT INTO housekeeping_task_mgmt
  (id, property_id, type, category, location, assigned_to, attendant_id,
   priority, due_date, status, progress, service_type, floor, checklist,
   started_at, completed_at, notes)
SELECT
  cj.id,
  cj.property_id,
  CASE cj.service_type
    WHEN 'Full Service'     THEN 'Checkout Cleaning'
    WHEN 'Stayover Service'  THEN 'Stayover Service'
    WHEN 'Express Service'   THEN 'Early Arrival Preparation'
    WHEN 'Eco Service'       THEN 'Stayover Service'
    WHEN 'Turndown Service'  THEN 'Turndown Service'
  END,
  'Automatic',
  'Room ' || cj.room_number,
  cj.attendant_name,
  cj.attendant_id,
  CASE cj.status
    WHEN 'Completed' THEN 'Low'
    WHEN 'In Progress' THEN 'High'
    ELSE 'Medium'
  END,
  COALESCE(cj.started_at, ''),
  cj.status,
  CASE
    WHEN cj.status = 'Completed' THEN 100
    WHEN cj.status = 'In Progress' THEN 50
    ELSE 0
  END,
  cj.service_type,
  cj.floor::TEXT,
  COALESCE(cj.checklist, '{}'::jsonb),
  cj.started_at,
  cj.completed_at,
  cj.notes
FROM housekeeping_cleaning_jobs cj
WHERE NOT EXISTS (
  SELECT 1 FROM housekeeping_task_mgmt tm WHERE tm.id = cj.id
);

-- ── 3. Seed public-area tasks from §8 ─────────────────────────────────────
-- The old PublicAreaCleaningModule used hardcoded seed data (no DB). Insert
-- those 14 areas as 'Public Area Cleaning' tasks so they appear in the
-- unified list. Uses the demo property.

INSERT INTO housekeeping_task_mgmt
  (id, property_id, type, category, location, assigned_to, priority,
   due_date, status, progress, frequency, last_cleaned)
VALUES
  ('PAC-101', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Lobby',           'Maria S.',  'High',     '07:00 AM', 'Completed', 100, 'Hourly',      '06:45 AM'),
  ('PAC-102', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Reception',       'Maria S.',  'High',     '07:00 AM', 'Completed', 100, 'Hourly',      '06:50 AM'),
  ('PAC-103', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Corridors',       'James L.',  'Medium',   '09:00 AM', 'In Progress', 50, 'Daily',       'Yesterday'),
  ('PAC-104', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Elevators',       NULL,         'High',     '08:00 AM', 'Pending',     0,  '4x Daily',    'Yesterday'),
  ('PAC-105', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Restrooms',       'Priya K.',  'Critical', '07:30 AM', 'In Progress', 50, '2x Daily',    '06:30 AM'),
  ('PAC-106', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Meeting Rooms',   'Carlos M.', 'Medium',   '10:00 AM', 'Pending',     0,  'Per Event',   'Yesterday'),
  ('PAC-107', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Restaurants',     'Aisha B.',  'High',     '06:00 AM', 'Completed', 100, 'Per Service', '05:50 AM'),
  ('PAC-108', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Bars',            NULL,         'Medium',   '04:00 PM', 'Pending',     0,  'Per Service', 'Yesterday'),
  ('PAC-109', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Pool Area',       'Maria S.',  'Medium',   '08:00 AM', 'Completed', 100, 'Daily',       '07:55 AM'),
  ('PAC-110', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Spa',             NULL,         'Medium',   '09:00 AM', 'Pending',     0,  'Daily',       'Yesterday'),
  ('PAC-111', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Fitness Center',  NULL,         'Medium',   '07:00 AM', 'Completed', 100, '2x Daily',    '06:50 AM'),
  ('PAC-112', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Parking Areas',   NULL,         'Low',      '12:00 PM', 'Pending',     0,  'Daily',       'Yesterday'),
  ('PAC-113', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Staff Areas',     NULL,         'Low',      '11:00 AM', 'Pending',     0,  'Daily',       'Yesterday'),
  ('PAC-114', '18762279-a389-41c9-9169-7ebc682e9703', 'Public Area Cleaning', 'Automatic', 'Offices',         NULL,         'Low',      '02:00 PM', 'Pending',     0,  'Daily',       'Yesterday')
ON CONFLICT (id) DO NOTHING;
