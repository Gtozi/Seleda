-- ============================================================
-- Engineering Portal — Inspections (Migration 332)
-- ============================================================
-- Backs the /erp/maintenance/inspections tab (Inspections.tsx).
-- Previously the module rendered hardcoded mock data in useState. This
-- migration persists that contract to the DB so the module can
-- fetch/persist via /api/eng-portal/inspections.
--
-- An inspection is a compliance / safety / regulatory / preventive
-- inspection. It flows:
--   Scheduled → In Progress → (Completed | Failed)
--   (+ Overdue: auto-derived when a Scheduled inspection passes its
--    scheduled_date without starting — enforced server-side in the
--    GET route).
-- "Convert to Work Order" creates a real row in work_orders and links
-- it back via converted_work_order_id, integrating with the Work Order
-- Management console (/erp/maintenance/workorders). Typically used when
-- an inspection Fails and a repair work order is needed.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_inspections (
  id                       TEXT PRIMARY KEY,
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  ins_number               TEXT NOT NULL,
  type                     TEXT NOT NULL CHECK (type IN (
                             'Fire Safety', 'Elevator', 'Boiler', 'Electrical',
                             'Water System', 'HVAC', 'Structural', 'Environmental'
                           )),
  category                 TEXT NOT NULL CHECK (category IN (
                             'Compliance', 'Safety', 'Preventive', 'Regulatory', 'Insurance'
                           )),
  location                 TEXT NOT NULL,
  room_number              TEXT,
  description              TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                             'Scheduled', 'In Progress', 'Completed', 'Failed', 'Overdue'
                           )),
  priority                 TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                             'Critical', 'High', 'Normal', 'Low'
                           )),
  scheduled_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_date           TIMESTAMPTZ,
  inspector                TEXT,
  findings                 TEXT,
  next_due_date            TIMESTAMPTZ,
  converted_work_order_id  TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  in_progress_at           TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_inspections_property
  ON public.eng_inspections(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_inspections_status
  ON public.eng_inspections(status);
CREATE INDEX IF NOT EXISTS idx_eng_inspections_type
  ON public.eng_inspections(type);
CREATE INDEX IF NOT EXISTS idx_eng_inspections_category
  ON public.eng_inspections(category);
CREATE INDEX IF NOT EXISTS idx_eng_inspections_priority
  ON public.eng_inspections(priority);
CREATE INDEX IF NOT EXISTS idx_eng_inspections_scheduled_date
  ON public.eng_inspections(scheduled_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_eng_inspections_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_inspections_updated_at
  ON public.eng_inspections;
CREATE TRIGGER trg_eng_inspections_updated_at
  BEFORE UPDATE ON public.eng_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_inspections_timestamp();

ALTER TABLE public.eng_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_inspections"
  ON public.eng_inspections FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_inspections TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 6 inspections previously hardcoded as useState initial state in
-- Inspections.tsx. Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.eng_inspections
  (id, property_id, ins_number, type, category, location, room_number,
   description, status, priority, scheduled_date, completed_date, inspector,
   findings, next_due_date)
VALUES
  ('INS-001', '18762279-a389-41c9-9169-7ebc682e9703', 'INS-2026-001',
   'Fire Safety', 'Compliance', 'All Floors', NULL,
   'Annual fire alarm system inspection and testing',
   'Completed', 'Critical', '2026-07-15', '2026-07-15', 'Fire Safety Inspector',
   'All systems operational. Minor repairs required on 2 smoke detectors.',
   '2027-07-15'),
  ('INS-002', '18762279-a389-41c9-9169-7ebc682e9703', 'INS-2026-002',
   'Elevator', 'Safety', 'Service Elevator Alpha', NULL,
   'Quarterly elevator safety inspection and load testing',
   'In Progress', 'Critical', '2026-07-29', NULL, 'Elevator Inspector',
   NULL, NULL),
  ('INS-003', '18762279-a389-41c9-9169-7ebc682e9703', 'INS-2026-003',
   'Boiler', 'Regulatory', 'Boiler Room', NULL,
   'Annual boiler pressure vessel inspection',
   'Scheduled', 'Critical', '2026-08-10', NULL, NULL, NULL, NULL),
  ('INS-004', '18762279-a389-41c9-9169-7ebc682e9703', 'INS-2026-004',
   'Electrical', 'Preventive', 'Main Distribution Panels', NULL,
   'Thermal imaging of electrical panels',
   'Scheduled', 'High', '2026-08-15', NULL, NULL, NULL, NULL),
  ('INS-005', '18762279-a389-41c9-9169-7ebc682e9703', 'INS-2026-005',
   'Water System', 'Compliance', 'Water Tank Room', NULL,
   'Water quality testing and tank inspection',
   'Overdue', 'High', '2026-07-20', NULL, 'Health Inspector', NULL, NULL),
  ('INS-006', '18762279-a389-41c9-9169-7ebc682e9703', 'INS-2026-006',
   'HVAC', 'Preventive', 'Rooftop Units', NULL,
   'HVAC system performance inspection',
   'Completed', 'Normal', '2026-07-10', '2026-07-10', 'HVAC Technician',
   'All units operating within normal parameters. Filter replacement recommended.',
   '2026-10-10')
ON CONFLICT (id) DO NOTHING;
