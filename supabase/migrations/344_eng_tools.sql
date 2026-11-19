-- ============================================================
-- Engineering Portal — Tools Registry & Checkout (Migration 344)
-- ============================================================
-- Backs the "Tools" sub-tab of the /erp/maintenance/spare-parts
-- tab (renamed "Spare Parts & Tools"). Tools are durable, trackable
-- assets (not consumable like spare parts) — each tool is a unique
-- item with a status lifecycle and a checkout/return history to
-- technicians.
--
-- Two tables:
--   1. eng_tools            — the tool registry (one row per tool)
--   2. eng_tool_checkouts   — checkout/return history per tool
--
-- Tool status lifecycle:
--   Available → Checked Out (technician checks out) → Available (return)
--   Available → In Repair → Available
--   Available → Lost (terminal, unless found and returned to Available)
--   Available → Retired (terminal)
--
-- Checkout workflow:
--   Active (checked out, not yet returned) → Returned
--   Overdue is auto-derived: Active rows whose expected_return_at has
--   passed are surfaced as Overdue by the GET endpoint.
-- ============================================================

-- ── 1. eng_tools ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_tools (
  id                   TEXT PRIMARY KEY,
  property_id          UUID,
  tool_number          TEXT NOT NULL,
  tool_name            TEXT NOT NULL,
  category             TEXT,
  manufacturer         TEXT,
  model                TEXT,
  serial_number        TEXT,
  location             TEXT,
  status               TEXT NOT NULL DEFAULT 'Available' CHECK (status IN (
                         'Available', 'Checked Out', 'In Repair', 'Lost', 'Retired'
                       )),
  condition            TEXT NOT NULL DEFAULT 'Good' CHECK (condition IN (
                         'New', 'Good', 'Fair', 'Poor'
                       )),
  assigned_to          TEXT,
  purchase_date        DATE,
  purchase_cost        NUMERIC(12,2) DEFAULT 0,
  calibration_due_date DATE,
  notes                TEXT,
  created_by           TEXT,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_tools_property ON public.eng_tools(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_tools_status  ON public.eng_tools(status);
CREATE INDEX IF NOT EXISTS idx_eng_tools_category ON public.eng_tools(category);

CREATE OR REPLACE FUNCTION public.update_eng_tools_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_tools_updated_at ON public.eng_tools;
CREATE TRIGGER trigger_eng_tools_updated_at
  BEFORE UPDATE ON public.eng_tools
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_tools_timestamp();

ALTER TABLE public.eng_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_tools"
  ON public.eng_tools FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_tools TO authenticated;

-- ── 2. eng_tool_checkouts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_tool_checkouts (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id        UUID,
  tool_id            TEXT NOT NULL REFERENCES public.eng_tools(id) ON DELETE CASCADE,
  technician         TEXT NOT NULL,
  work_order         TEXT,
  checked_out_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expected_return_at TIMESTAMP WITH TIME ZONE,
  returned_at        TIMESTAMP WITH TIME ZONE,
  status             TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                       'Active', 'Returned', 'Overdue'
                     )),
  checkout_notes     TEXT,
  return_notes       TEXT,
  created_by         TEXT,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_tool_co_property ON public.eng_tool_checkouts(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_tool_co_tool     ON public.eng_tool_checkouts(tool_id);
CREATE INDEX IF NOT EXISTS idx_eng_tool_co_status   ON public.eng_tool_checkouts(status);
CREATE INDEX IF NOT EXISTS idx_eng_tool_co_tech     ON public.eng_tool_checkouts(technician);

CREATE OR REPLACE FUNCTION public.update_eng_tool_checkouts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_eng_tool_co_updated_at ON public.eng_tool_checkouts;
CREATE TRIGGER trigger_eng_tool_co_updated_at
  BEFORE UPDATE ON public.eng_tool_checkouts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_tool_checkouts_timestamp();

ALTER TABLE public.eng_tool_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_tool_checkouts"
  ON public.eng_tool_checkouts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_tool_checkouts TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).
-- 6 tools spanning common engineering categories, plus 2 active checkouts
-- and 1 historical (returned) checkout so the UI has data on a fresh DB.

INSERT INTO public.eng_tools
  (id, property_id, tool_number, tool_name, category, manufacturer, model,
   serial_number, location, status, condition, assigned_to, purchase_date,
   purchase_cost, calibration_due_date, notes)
VALUES
  ('ENG-TL-01', '18762279-a389-41c9-9169-7ebc682e9703', 'TL-001', 'Cordless Impact Drill', 'Power Tools', 'Bosch', 'GDS 18V-EC', 'SN-DRILL-001', 'Engineering Store', 'Checked Out', 'Good', 'Solomon Girma', '2024-02-10', 450.00, NULL, 'Standard 1/2" drive impact drill'),
  ('ENG-TL-02', '18762279-a389-41c9-9169-7ebc682e9703', 'TL-002', 'Digital Multimeter', 'Electrical', 'Fluke', '87V Industrial', 'SN-MM-002', 'Electrical Workshop', 'Available', 'New', NULL, '2025-01-15', 380.00, '2026-12-01', 'Calibrated industrial multimeter'),
  ('ENG-TL-03', '18762279-a389-41c9-9169-7ebc682e9703', 'TL-003', 'Pipe Wrench Set (14")', 'Plumbing', 'Ridgid', 'RapidGrip 14', 'SN-PW-003', 'Plumbing Cabinet', 'Available', 'Good', NULL, '2023-08-20', 120.00, NULL, 'Heavy-duty pipe wrench'),
  ('ENG-TL-04', '18762279-a389-41c9-9169-7ebc682e9703', 'TL-004', 'HVAC Manifold Gauge Set', 'HVAC', 'Yellow Jacket', '42004 4-Valve', 'SN-HVAC-004', 'HVAC Workshop', 'In Repair', 'Fair', NULL, '2022-06-05', 290.00, '2026-09-01', '4-valve manifold, gauge needs replacement'),
  ('ENG-TL-05', '18762279-a389-41c9-9169-7ebc682e9703', 'TL-005', 'Extension Ladder (20ft)', 'General', 'Werner', 'D1220-2', 'SN-LAD-005', 'Storage Room B', 'Available', 'Good', NULL, '2023-03-12', 180.00, NULL, 'Type I 20ft aluminum ladder'),
  ('ENG-TL-06', '18762279-a389-41c9-9169-7ebc682e9703', 'TL-006', 'Thermal Imaging Camera', 'Inspection', 'FLIR', 'E54', 'SN-FLIR-006', 'Engineering Store', 'Checked Out', 'New', 'Haile Mariam', '2025-05-22', 1850.00, '2027-05-01', 'High-resolution IR camera for electrical inspection')
ON CONFLICT (id) DO NOTHING;

-- 2 active checkouts + 1 returned (historical)
INSERT INTO public.eng_tool_checkouts
  (id, property_id, tool_id, technician, work_order, checked_out_at,
   expected_return_at, returned_at, status, checkout_notes, return_notes, created_by)
VALUES
  ('ENG-CO-01', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-TL-01', 'Solomon Girma', 'WO-2026-014',
   '2026-08-20 08:30:00+00', '2026-08-27 17:00:00+00', NULL, 'Active',
   'Panel board rewiring in Zone B', NULL, 'system'),
  ('ENG-CO-02', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-TL-06', 'Haile Mariam', 'WO-2026-021',
   '2026-08-22 09:00:00+00', '2026-08-29 17:00:00+00', NULL, 'Active',
   'Thermal scan of chiller units', NULL, 'system'),
  ('ENG-CO-03', '18762279-a389-41c9-9169-7ebc682e9703', 'ENG-TL-03', 'Tadesse Bekele', 'WO-2026-009',
   '2026-08-10 07:45:00+00', '2026-08-12 17:00:00+00', '2026-08-12 16:20:00+00', 'Returned',
   'Bathroom pipe replacement Room 204', 'Tool returned in good condition', 'system')
ON CONFLICT (id) DO NOTHING;
