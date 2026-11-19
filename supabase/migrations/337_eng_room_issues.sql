-- Migration: Engineering Room Maintenance Issues
-- Backs the /erp/maintenance/rooms tab (RoomMaintenanceModule.tsx).
-- Previously the module rendered a hardcoded `roomIssues` array (4 rows) and
-- room status actions were local-only (setRoomStatus from ERPContext, which
-- only updates React state). This migration persists that contract to the DB
-- so the module can fetch/persist via /api/eng-portal/room-issues and sync
-- rooms.status with the rest of the ERP (Front Office, Housekeeping).
--
-- Issue lifecycle: Open → In Progress → Resolved.
-- `blocks_room` indicates the issue takes the room out of inventory (the
-- backend sets rooms.status = 'Out of Order' when an issue is created with
-- blocks_room = true, and restores the room when the issue is resolved).

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_room_issues (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  ri_number     TEXT,
  room_number   TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
                  'Plumbing', 'HVAC', 'Electrical', 'Security', 'Furniture',
                  'Lock', 'TV', 'Internet', 'Lighting', 'Other'
                )),
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Open' CHECK (status IN (
                  'Open', 'In Progress', 'Resolved'
                )),
  priority      TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                  'Emergency', 'High', 'Normal', 'Low'
                )),
  blocks_room   BOOLEAN NOT NULL DEFAULT FALSE,
  reported_by   TEXT,
  assigned_to   TEXT,
  resolved_at   TIMESTAMP WITH TIME ZONE,
  notes         TEXT,
  converted_work_order_id TEXT,
  converted_at  TIMESTAMP WITH TIME ZONE,
  created_by    TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_room_issues_property
  ON public.eng_room_issues(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_room_issues_room
  ON public.eng_room_issues(room_number);
CREATE INDEX IF NOT EXISTS idx_eng_room_issues_status
  ON public.eng_room_issues(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_eng_room_issues_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_room_issues_updated_at ON public.eng_room_issues;
CREATE TRIGGER trigger_eng_room_issues_updated_at
  BEFORE UPDATE ON public.eng_room_issues
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_room_issues_timestamp();

ALTER TABLE public.eng_room_issues ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_room_issues TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 4 issues previously hardcoded as `roomIssues` in
-- RoomMaintenanceModule.tsx. Uses the single demo property.
INSERT INTO public.eng_room_issues
  (id, property_id, ri_number, room_number, category, description, status, priority, blocks_room, reported_by, assigned_to)
VALUES
  ('RI-101', '18762279-a389-41c9-9169-7ebc682e9703', 'RI-2026-000101', '101', 'Plumbing',   'Sink leakage',            'Open', 'High',   TRUE,  'Front Desk', 'Plumbing Team'),
  ('RI-204', '18762279-a389-41c9-9169-7ebc682e9703', 'RI-2026-000204', '204', 'HVAC',       'AC making noise',         'Open', 'High',   TRUE,  'Front Desk', 'HVAC Team'),
  ('RI-302', '18762279-a389-41c9-9169-7ebc682e9703', 'RI-2026-000302', '302', 'Electrical', 'TV Remote not working',   'Open', 'Normal', FALSE, 'Front Desk', NULL),
  ('RI-105', '18762279-a389-41c9-9169-7ebc682e9703', 'RI-2026-000105', '105', 'Security',   'Door lock battery low',   'Open', 'Normal', FALSE, 'Front Desk', NULL)
ON CONFLICT (id) DO NOTHING;
