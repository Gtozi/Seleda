-- 324_eng_corrective_maintenance.sql
-- Engineering Portal — Corrective Maintenance module.
-- Backs the /erp/maintenance/corrective-maintenance tab (CorrectiveMaintenance.tsx).
-- Previously the module rendered hardcoded mock data in useState. This migration
-- persists that contract to the DB so the module can fetch/persist via
-- /api/eng-portal/corrective-maintenance.
--
-- A corrective task is a reactive repair / emergency response / equipment
-- breakdown resolution. It flows:
--   Reported → Diagnosed → In Progress → Parts Ordered → Completed → Verified
-- "Convert to Work Order" creates a real row in work_orders and links it back
-- via converted_work_order_id, integrating with the Work Order Management
-- console (/erp/maintenance/workorders).

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.corrective_maintenance_tasks (
  id                       TEXT PRIMARY KEY,
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  cm_number                TEXT NOT NULL,
  reported_date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type                     TEXT NOT NULL,
  category                 TEXT NOT NULL CHECK (category IN (
                             'Reactive Repairs', 'Emergency Repairs',
                             'Guest Complaint Resolution', 'Equipment Breakdown',
                             'Infrastructure Repair', 'Utility Failure Response'
                           )),
  location                 TEXT NOT NULL,
  room_number              TEXT,
  priority                 TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                             'Emergency', 'High', 'Normal', 'Low'
                           )),
  description              TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Reported' CHECK (status IN (
                             'Reported', 'Diagnosed', 'In Progress', 'Parts Ordered',
                             'Completed', 'Verified'
                           )),
  assigned_technician      TEXT,
  estimated_cost           NUMERIC DEFAULT 0,
  actual_cost             NUMERIC DEFAULT 0,
  downtime                 TEXT,
  resolution               TEXT,
  converted_work_order_id  TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  diagnosed_at             TIMESTAMPTZ,
  in_progress_at           TIMESTAMPTZ,
  parts_ordered_at         TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  verified_at              TIMESTAMPTZ,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corrective_maintenance_property
  ON public.corrective_maintenance_tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_corrective_maintenance_status
  ON public.corrective_maintenance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_corrective_maintenance_category
  ON public.corrective_maintenance_tasks(category);
CREATE INDEX IF NOT EXISTS idx_corrective_maintenance_priority
  ON public.corrective_maintenance_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_corrective_maintenance_reported_date
  ON public.corrective_maintenance_tasks(reported_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_corrective_maintenance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_corrective_maintenance_updated_at
  ON public.corrective_maintenance_tasks;
CREATE TRIGGER trg_corrective_maintenance_updated_at
  BEFORE UPDATE ON public.corrective_maintenance_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_corrective_maintenance_timestamp();

ALTER TABLE public.corrective_maintenance_tasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corrective_maintenance_tasks TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 6 corrective tasks previously hardcoded as useState initial state in
-- CorrectiveMaintenance.tsx. Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.corrective_maintenance_tasks
  (id, property_id, cm_number, reported_date, type, category, location,
   room_number, priority, description, status, assigned_technician,
   estimated_cost, actual_cost, downtime, resolution)
VALUES
  ('CM-1001', '18762279-a389-41c9-9169-7ebc682e9703', 'CM-2026-001',
   '2026-07-29 10:15+00', 'Electrical', 'Emergency Repairs', 'Lobby', NULL,
   'Emergency',
   'Main distribution panel tripped. Power outage affecting lobby and front desk.',
   'In Progress', 'John Electrician', 450, 0, '2 hours', NULL),
  ('CM-1002', '18762279-a389-41c9-9169-7ebc682e9703', 'CM-2026-002',
   '2026-07-29 09:30+00', 'Plumbing', 'Guest Complaint Resolution', 'Room 312',
   '312', 'High',
   'Guest reported water leak from ceiling. Possible pipe burst in bathroom above.',
   'Diagnosed', 'Carlos Plumber', 280, 0, '4 hours', NULL),
  ('CM-1003', '18762279-a389-41c9-9169-7ebc682e9703', 'CM-2026-003',
   '2026-07-29 08:00+00', 'HVAC', 'Equipment Breakdown', 'Kitchen', NULL, 'High',
   'Walk-in freezer compressor failure. Temperature rising above safe levels.',
   'Parts Ordered', 'Maria HVAC', 1200, 1150, '24 hours', NULL),
  ('CM-1004', '18762279-a389-41c9-9169-7ebc682e9703', 'CM-2026-004',
   '2026-07-28 16:45+00', 'Fire & Life Safety', 'Infrastructure Repair',
   'Fire Pump Room', NULL, 'Emergency',
   'Fire pump pressure switch malfunction. System not maintaining required pressure.',
   'Completed', 'David Mechanic', 350, 340, '6 hours',
   'Replaced pressure switch and calibrated system. Fire pump now operational.'),
  ('CM-1005', '18762279-a389-41c9-9169-7ebc682e9703', 'CM-2026-005',
   '2026-07-28 14:20+00', 'Electrical', 'Utility Failure Response',
   'Generator Room', NULL, 'High',
   'Backup generator fuel gauge sensor failure. Unable to monitor fuel levels.',
   'Verified', 'John Electrician', 180, 175, '1 hour',
   'Replaced fuel level sensor. System tested and verified.'),
  ('CM-1006', '18762279-a389-41c9-9169-7ebc682e9703', 'CM-2026-006',
   '2026-07-28 11:00+00', 'Elevators', 'Reactive Repairs', 'Elevator B', NULL,
   'Normal',
   'Elevator B door sensors not detecting obstacles. Safety concern.',
   'Reported', NULL, 250, 0, '4 hours', NULL)
ON CONFLICT (id) DO NOTHING;
