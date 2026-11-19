-- Migration: Housekeeping Maintenance Coordination Issues
-- Backs the Maintenance Coordination module (docs/Housekeeping Portal new.md §20).
-- Issue Reporting (8 categories) and workflow:
--   Report Issue → Assign Engineering → Track Status → Verify Completion → Release Room.
--
-- Previously the module rendered hardcoded `seed` data (MaintenanceCoordinationModule.tsx).
-- This migration persists that contract to the DB so the module can fetch/persist
-- via /api/hk-portal/maintenance.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housekeeping_maintenance_issues (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  type          TEXT NOT NULL CHECK (type IN (
                  'Plumbing', 'Electrical', 'HVAC', 'Furniture Damage',
                  'Lock Problems', 'Lighting', 'TV', 'Internet'
                )),
  room          TEXT NOT NULL,
  reported_by   TEXT NOT NULL,
  reported_at   TEXT NOT NULL,
  stage         TEXT NOT NULL DEFAULT 'Reported' CHECK (stage IN (
                  'Reported', 'Assigned to Engineering', 'In Progress',
                  'Completed', 'Verified', 'Room Released'
                )),
  assigned_to   TEXT,
  notes         TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hk_maint_issues_property
  ON housekeeping_maintenance_issues(property_id);
CREATE INDEX IF NOT EXISTS idx_hk_maint_issues_stage
  ON housekeeping_maintenance_issues(stage);
CREATE INDEX IF NOT EXISTS idx_hk_maint_issues_type
  ON housekeeping_maintenance_issues(type);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_hk_maint_issues_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hk_maint_issues_updated_at ON housekeeping_maintenance_issues;
CREATE TRIGGER trigger_hk_maint_issues_updated_at
  BEFORE UPDATE ON housekeeping_maintenance_issues
  FOR EACH ROW
  EXECUTE FUNCTION update_hk_maint_issues_timestamp();

GRANT SELECT, INSERT, UPDATE, DELETE ON housekeeping_maintenance_issues TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 6 issues previously hardcoded as `seed` in
-- MaintenanceCoordinationModule.tsx. Uses the single demo property.
INSERT INTO housekeeping_maintenance_issues
  (id, property_id, type, room, reported_by, reported_at, stage, assigned_to, notes)
VALUES
  ('MC-1201', '18762279-a389-41c9-9169-7ebc682e9703', 'Plumbing',        '306', 'Maria S.',  '08:15 AM',  'In Progress',             'Eng. Team A', 'Leaking bathroom faucet'),
  ('MC-1202', '18762279-a389-41c9-9169-7ebc682e9703', 'HVAC',            '410', 'James L.',  '09:40 AM',  'Assigned to Engineering', 'Eng. Team B', 'AC not cooling'),
  ('MC-1203', '18762279-a389-41c9-9169-7ebc682e9703', 'Electrical',      '204', 'Priya K.',  '10:05 AM',  'Reported',                NULL,           'Outlet near bed not working'),
  ('MC-1204', '18762279-a389-41c9-9169-7ebc682e9703', 'TV',              '502', 'Carlos M.', '07:30 AM',  'Completed',               'Eng. Team A', 'TV remote unresponsive'),
  ('MC-1205', '18762279-a389-41c9-9169-7ebc682e9703', 'Lock Problems',   '118', 'Aisha B.',  '06:50 AM',  'Verified',                'Eng. Team C', 'Door lock battery dead'),
  ('MC-1206', '18762279-a389-41c9-9169-7ebc682e9703', 'Lighting',        '305', 'Maria S.',  'Yesterday', 'Room Released',           'Eng. Team B', 'Bedside lamp replaced')
ON CONFLICT (id) DO NOTHING;
