-- 322_eng_work_requests.sql
-- Engineering Portal — Work Requests module.
-- Backs the /erp/maintenance/work-requests tab (WorkRequests.tsx).
-- Previously the module rendered hardcoded mock data. This migration persists
-- that contract to the DB so the module can fetch/persist via
-- /api/eng-portal/work-requests.
--
-- A work request is an incoming maintenance request from any department
-- (Front Office, Housekeeping, F&B, Security, Spa, IoT, Scheduled Inspections…).
-- It flows: Pending → Reviewed → Approved → (Converted to WO | Rejected).
-- "Converted to WO" creates a real row in work_orders and links it back via
-- converted_work_order_id, integrating with the Engineering Work Order console.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.work_requests (
  id                       TEXT PRIMARY KEY,
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  wr_number                TEXT NOT NULL,
  request_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source                   TEXT NOT NULL,
  source_type              TEXT NOT NULL,
  location                 TEXT NOT NULL,
  room_number              TEXT,
  priority                 TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                             'Emergency', 'High', 'Normal', 'Low'
                           )),
  type                     TEXT NOT NULL,
  description              TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (
                             'Pending', 'Reviewed', 'Approved', 'Rejected',
                             'Converted to WO'
                           )),
  requested_by             TEXT NOT NULL,
  attachments              INTEGER NOT NULL DEFAULT 0,
  converted_work_order_id  TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  reviewed_at              TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  converted_at             TIMESTAMPTZ,
  review_notes             TEXT,
  rejection_reason         TEXT,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_requests_property
  ON public.work_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_work_requests_status
  ON public.work_requests(status);
CREATE INDEX IF NOT EXISTS idx_work_requests_source
  ON public.work_requests(source);
CREATE INDEX IF NOT EXISTS idx_work_requests_priority
  ON public.work_requests(priority);
CREATE INDEX IF NOT EXISTS idx_work_requests_request_date
  ON public.work_requests(request_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_work_requests_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_requests_updated_at ON public.work_requests;
CREATE TRIGGER trg_work_requests_updated_at
  BEFORE UPDATE ON public.work_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_work_requests_timestamp();

ALTER TABLE public.work_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_requests TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 7 work requests previously hardcoded as useState initial state in
-- WorkRequests.tsx. Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.work_requests
  (id, property_id, wr_number, request_date, source, source_type, location,
   room_number, priority, type, description, status, requested_by, attachments)
VALUES
  ('WR-1001', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-001',
   '2026-07-29 10:30+00', 'Front Office', 'Front Office', 'Room 205', '205',
   'Emergency', 'Electrical',
   'Power outage in guest room. Guest unable to use lights or AC.',
   'Pending', 'Sarah Front Desk', 0),
  ('WR-1002', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-002',
   '2026-07-29 09:15+00', 'Housekeeping', 'Housekeeping', 'Room 112', '112',
   'High', 'Plumbing',
   'Bathroom sink drain clogged. Water not draining properly.',
   'Reviewed', 'Maria Housekeeping', 1),
  ('WR-1003', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-003',
   '2026-07-29 08:45+00', 'Food & Beverage', 'Food & Beverage', 'Main Kitchen',
   NULL, 'High', 'Kitchen Equipment',
   'Commercial refrigerator not cooling. Temperature rising above safe levels.',
   'Approved', 'Chef Michael', 2),
  ('WR-1004', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-004',
   '2026-07-29 07:30+00', 'IoT Sensors', 'IoT Sensors', 'Boiler Room', NULL,
   'Normal', 'HVAC',
   'Temperature sensor alert - Boiler operating outside normal parameters.',
   'Pending', 'System Automated', 0),
  ('WR-1005', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-005',
   '2026-07-28 16:20+00', 'Security', 'Security', 'Lobby', NULL,
   'Normal', 'Lock & Door',
   'Main entrance door lock mechanism sticking. Difficult to open/close.',
   'Converted to WO', 'James Security', 0),
  ('WR-1006', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-006',
   '2026-07-28 14:10+00', 'Spa', 'Spa', 'Spa Pool Area', NULL,
   'Normal', 'Plumbing',
   'Pool filter showing reduced flow rate. Backwash may be required.',
   'Reviewed', 'Lisa Spa Manager', 1),
  ('WR-1007', '18762279-a389-41c9-9169-7ebc682e9703', 'WR-2026-007',
   '2026-07-28 11:00+00', 'Scheduled Inspections', 'Scheduled Inspections',
   'All Guest Rooms', NULL, 'Low', 'Fire & Life Safety',
   'Monthly fire alarm system inspection - Room smoke detectors.',
   'Approved', 'System Scheduled', 0)
ON CONFLICT (id) DO NOTHING;
