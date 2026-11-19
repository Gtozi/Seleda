-- Migration: Housekeeping Supervisor Console
-- Adds the hk_escalations table backing the Supervisor Console module
-- (docs/Housekeeping Portal new.md §11) and seeds the 3 mock escalations
-- that were previously hardcoded in SupervisorConsoleModule.tsx.
--
-- The Supervisor Console is an aggregation/oversight view. Most of its data
-- is derived at query time from existing tables:
--   - Live Room Monitor  → housekeeping_task_mgmt (active tasks) + rooms
--   - Inspection Approval → room_inspections where result = 'Pending'
--   - Staff Performance   → housekeeping_staff (rooms_completed, inspection_score)
--   - Shift Summary       → computed from counts across tasks/inspections/escalations
-- Only escalations need a dedicated table.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hk_escalations (
  id           TEXT PRIMARY KEY,
  property_id  UUID,
  room_number  TEXT,
  issue        TEXT NOT NULL,
  level        TEXT NOT NULL DEFAULT 'Medium' CHECK (level IN (
                 'Low', 'Medium', 'High', 'Critical'
               )),
  status       TEXT NOT NULL DEFAULT 'Open' CHECK (status IN (
                 'Open', 'Resolved'
               )),
  raised_at    TEXT,
  resolved_at  TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_escalations_property
  ON hk_escalations(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_escalations_status
  ON hk_escalations(status);
CREATE INDEX IF NOT EXISTS idx_hk_escalations_level
  ON hk_escalations(level);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_escalations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_escalations_updated_at ON hk_escalations;
CREATE TRIGGER trigger_hk_escalations_updated_at
  BEFORE UPDATE ON hk_escalations
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_escalations_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_escalations TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 3 escalations previously hardcoded in SupervisorConsoleModule.tsx.
-- Uses the single demo property.
INSERT INTO hk_escalations
  (id, property_id, room_number, issue, level, status, raised_at)
VALUES
  ('ESC-01', '18762279-a389-41c9-9169-7ebc682e9703', '102', 'Failed bathroom inspection — rework required', 'High',     'Open', '10:15 AM'),
  ('ESC-02', '18762279-a389-41c9-9169-7ebc682e9703', '502', 'VIP arrival in 30 min, room not ready',         'Critical', 'Open', '10:30 AM'),
  ('ESC-03', '18762279-a389-41c9-9169-7ebc682e9703', '306', 'Maintenance awaiting access blocking cleaning',  'Medium',   'Open', '09:45 AM')
ON CONFLICT (id) DO NOTHING;
