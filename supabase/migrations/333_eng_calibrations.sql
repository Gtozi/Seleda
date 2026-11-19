-- ============================================================
-- Engineering Portal — Calibration Management (Migration 333)
-- ============================================================
-- Backs the /erp/maintenance/calibration tab (CalibrationManagement.tsx).
-- Previously the module rendered hardcoded mock data in useState. This
-- migration persists that contract to the DB so the module can
-- fetch/persist via /api/eng-portal/calibrations.
--
-- A calibration is an instrument / measurement-device calibration for
-- accuracy, compliance, and regulatory traceability. It flows:
--   Scheduled → In Progress → (Completed | Failed)
--   (+ Overdue: auto-derived when a Scheduled calibration passes its
--    scheduled_date without starting — enforced server-side in the
--    GET route).
-- "Convert to Work Order" creates a real row in work_orders and links
-- it back via converted_work_order_id, integrating with the Work Order
-- Management console (/erp/maintenance/workorders). Typically used when
-- a calibration Fails and a repair/replacement work order is needed.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_calibrations (
  id                       TEXT PRIMARY KEY,
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  cal_number               TEXT NOT NULL,
  equipment_id             TEXT,
  equipment_name           TEXT NOT NULL,
  instrument_type          TEXT NOT NULL CHECK (instrument_type IN (
                             'Temperature Sensor', 'Pressure Gauge', 'Flow Meter',
                             'Electrical Meter', 'Scale', 'Thermostat', 'Controller'
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
  calibrated_by            TEXT,
  previous_reading         TEXT,
  current_reading          TEXT,
  tolerance                TEXT,
  deviation                TEXT,
  next_due_date            TIMESTAMPTZ,
  converted_work_order_id  TEXT REFERENCES public.work_orders(id) ON DELETE SET NULL,
  in_progress_at           TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_calibrations_property
  ON public.eng_calibrations(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_calibrations_status
  ON public.eng_calibrations(status);
CREATE INDEX IF NOT EXISTS idx_eng_calibrations_instrument_type
  ON public.eng_calibrations(instrument_type);
CREATE INDEX IF NOT EXISTS idx_eng_calibrations_priority
  ON public.eng_calibrations(priority);
CREATE INDEX IF NOT EXISTS idx_eng_calibrations_scheduled_date
  ON public.eng_calibrations(scheduled_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_eng_calibrations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_calibrations_updated_at
  ON public.eng_calibrations;
CREATE TRIGGER trg_eng_calibrations_updated_at
  BEFORE UPDATE ON public.eng_calibrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_calibrations_timestamp();

ALTER TABLE public.eng_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_calibrations"
  ON public.eng_calibrations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_calibrations TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 5 calibrations previously hardcoded as useState initial state in
-- CalibrationManagement.tsx. Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.eng_calibrations
  (id, property_id, cal_number, equipment_id, equipment_name, instrument_type,
   location, description, status, priority, scheduled_date, completed_date,
   calibrated_by, previous_reading, current_reading, tolerance, deviation,
   next_due_date)
VALUES
  ('CAL-001', '18762279-a389-41c9-9169-7ebc682e9703', 'CAL-2026-001',
   'TEMP-01', 'Boiler Temperature Sensor', 'Temperature Sensor', 'Boiler Room',
   'Annual temperature sensor calibration for boiler control system',
   'Completed', 'Critical', '2026-07-20', '2026-07-20', 'Metrology Lab',
   '±2.5°C', '±0.5°C', '±1.0°C', 'Within tolerance', '2027-07-20'),
  ('CAL-002', '18762279-a389-41c9-9169-7ebc682e9703', 'CAL-2026-002',
   'PRESS-01', 'Water Pressure Gauge', 'Pressure Gauge', 'Pump Room',
   'Quarterly pressure gauge calibration',
   'In Progress', 'High', '2026-07-29', NULL, 'In-house Technician',
   NULL, NULL, NULL, NULL, NULL),
  ('CAL-003', '18762279-a389-41c9-9169-7ebc682e9703', 'CAL-2026-003',
   'FLOW-01', 'Water Flow Meter', 'Flow Meter', 'Main Water Line',
   'Annual flow meter calibration for water consumption tracking',
   'Scheduled', 'Normal', '2026-08-05', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL),
  ('CAL-004', '18762279-a389-41c9-9169-7ebc682e9703', 'CAL-2026-004',
   'ELEC-01', 'Main Electrical Meter', 'Electrical Meter', 'Main Distribution Panel',
   'Annual electrical meter calibration',
   'Overdue', 'Critical', '2026-07-15', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL),
  ('CAL-005', '18762279-a389-41c9-9169-7ebc682e9703', 'CAL-2026-005',
   'SCALE-01', 'Kitchen Scale', 'Scale', 'Main Kitchen',
   'Monthly scale calibration for food preparation',
   'Completed', 'Normal', '2026-07-10', '2026-07-10', 'In-house Technician',
   '±5g', '±2g', '±3g', 'Within tolerance', '2026-08-10')
ON CONFLICT (id) DO NOTHING;
