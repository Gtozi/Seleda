-- Migration: Security CCTV Management
-- Backs the /erp/security/cctv tab (CCTVManagement.tsx).
-- Extends the SHARED sec_cctv_cameras table (created in migration 600 for the
-- SOC camera board) — one source of truth for both views. The mock's CAM-001..
-- CAM-006 are the same cameras already seeded; this adds the management fields
-- (ip_address, health, retention, resolution, model), two extra statuses from
-- the management UI (Recording, Standby), seeds CAM-007 Loading Dock, and adds
-- a per-camera event log so Motion/Snapshot/Playback actions persist.
--
-- Changes:
--   1. ALTER sec_cctv_cameras — new columns + expanded status CHECK
--   2. Backfill management fields for CAM-001..006 + insert CAM-007
--   3. sec_cctv_events — per-camera event/activity log

-- ── 1. Extend sec_cctv_cameras ───────────────────────────────────────────
ALTER TABLE public.sec_cctv_cameras
  ADD COLUMN IF NOT EXISTS ip_address     TEXT,
  ADD COLUMN IF NOT EXISTS health         TEXT NOT NULL DEFAULT 'Good'
    CHECK (health IN ('Good', 'Fair', 'Poor')),
  ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS resolution     TEXT NOT NULL DEFAULT '1080p',
  ADD COLUMN IF NOT EXISTS model          TEXT;

-- Expand the status CHECK to the full management set.
ALTER TABLE public.sec_cctv_cameras DROP CONSTRAINT IF EXISTS sec_cctv_cameras_status_check;
ALTER TABLE public.sec_cctv_cameras
  ADD CONSTRAINT sec_cctv_cameras_status_check
  CHECK (status IN ('Online', 'Offline', 'Maintenance', 'Recording', 'Standby'));

-- ── 2. Backfill + seed ───────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- Values mirror the former hardcoded array in CCTVManagement.tsx.

UPDATE public.sec_cctv_cameras SET
  ip_address = '192.168.1.' || (100 + CAST(SUBSTRING(id FROM 5) AS INTEGER)),
  health     = CASE id WHEN 'CAM-004' THEN 'Poor' ELSE 'Good' END,
  model      = 'AXIS M3065',
  resolution = '1080p',
  retention_days = 30
WHERE id IN ('CAM-001','CAM-002','CAM-003','CAM-004','CAM-005','CAM-006');

INSERT INTO public.sec_cctv_cameras
  (id, property_id, name, location, status, recording, health, ip_address,
   model, resolution, retention_days, last_motion_at)
VALUES
  ('CAM-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Loading Dock', 'Service Areas',
   'Maintenance', FALSE, 'Fair', '192.168.1.107', 'AXIS M3065', '1080p', 30,
   '2024-01-15 07:00'::timestamptz)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Camera events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_cctv_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id   TEXT NOT NULL REFERENCES public.sec_cctv_cameras(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL DEFAULT 'Motion Detected' CHECK (event_type IN (
                'Motion Detected', 'Snapshot', 'Playback Requested',
                'Recording Started', 'Recording Stopped', 'Status Change',
                'Maintenance', 'Note'
              )),
  detail      TEXT,
  actor       TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_cctv_events_cam ON public.sec_cctv_events(camera_id);

ALTER TABLE public.sec_cctv_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_cctv_events TO authenticated;

-- Event log seeds (recent motion events matching the mock's lastMotion times)
INSERT INTO public.sec_cctv_events (camera_id, event_type, detail, actor, created_at)
SELECT * FROM (VALUES
  ('CAM-001', 'Motion Detected', 'Motion at lobby entrance', NULL, '2024-01-15 10:42'::timestamptz),
  ('CAM-002', 'Motion Detected', 'Motion at reception desk', NULL, '2024-01-15 10:44'::timestamptz),
  ('CAM-003', 'Motion Detected', 'Motion at elevator bank', NULL, '2024-01-15 10:40'::timestamptz),
  ('CAM-004', 'Status Change', 'Camera went offline — network check required', 'System', '2024-01-15 08:15'::timestamptz),
  ('CAM-005', 'Motion Detected', 'Motion at pool area', NULL, '2024-01-15 10:30'::timestamptz),
  ('CAM-006', 'Motion Detected', 'Motion at rear entrance', NULL, '2024-01-15 10:35'::timestamptz),
  ('CAM-007', 'Maintenance', 'Scheduled maintenance — lens cleaning', 'Carlos M.', '2024-01-15 07:00'::timestamptz)
) AS v(camera_id, event_type, detail, actor, created_at)
WHERE EXISTS (SELECT 1 FROM public.sec_cctv_cameras c WHERE c.id = v.camera_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.sec_cctv_events e
    WHERE e.camera_id = v.camera_id AND e.event_type = v.event_type AND e.detail = v.detail
  );
