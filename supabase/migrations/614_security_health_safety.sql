-- Migration: Security Health & Safety Coordination
-- Backs the /erp/security/health-safety tab (HealthSafetyCoordination.tsx).
--
-- Two tables:
--   1. sec_safety_inspections — safety inspection register (type, area,
--                               inspector, schedule, result, findings)
--   2. sec_safety_hazards     — hazard register with corrective-action
--                               lifecycle; nullable inspection_id FK links
--                               a hazard to the inspection that found it.

-- ── 1. Safety inspections ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_safety_inspections (
  id              TEXT PRIMARY KEY,
  property_id     UUID,
  title           TEXT NOT NULL,
  inspection_type TEXT NOT NULL DEFAULT 'Routine' CHECK (inspection_type IN (
                    'Routine', 'Fire Safety', 'Pool Safety', 'Kitchen Hygiene',
                    'Workplace', 'Compliance', 'Other'
                  )),
  area            TEXT,
  inspector       TEXT,
  status          TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
                    'Scheduled', 'In Progress', 'Completed', 'Cancelled'
                  )),
  result          TEXT CHECK (result IN ('Pass', 'Pass with Notes', 'Fail')),
  findings        TEXT,
  scheduled_at    TIMESTAMP WITH TIME ZONE,
  completed_at    TIMESTAMP WITH TIME ZONE,
  created_by      TEXT,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_safety_insp_prop ON public.sec_safety_inspections(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_safety_insp_status ON public.sec_safety_inspections(status);

CREATE OR REPLACE FUNCTION public.update_sec_safety_insp_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_safety_insp_updated_at ON public.sec_safety_inspections;
CREATE TRIGGER trigger_sec_safety_insp_updated_at
  BEFORE UPDATE ON public.sec_safety_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_safety_insp_timestamp();

ALTER TABLE public.sec_safety_inspections ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_safety_inspections TO authenticated;

-- ── 2. Hazard register ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sec_safety_hazards (
  id                TEXT PRIMARY KEY,
  property_id       UUID,
  title             TEXT NOT NULL,
  hazard_type       TEXT NOT NULL DEFAULT 'Other' CHECK (hazard_type IN (
                      'Slip-Trip-Fall', 'Electrical', 'Chemical', 'Fire',
                      'Structural', 'Ergonomic', 'Biological', 'Other'
                    )),
  severity          TEXT NOT NULL DEFAULT 'Medium' CHECK (severity IN (
                      'Critical', 'High', 'Medium', 'Low'
                    )),
  status            TEXT NOT NULL DEFAULT 'Reported' CHECK (status IN (
                      'Reported', 'Assessed', 'Corrective Action', 'Resolved', 'Closed'
                    )),
  location          TEXT,
  description       TEXT,
  corrective_action TEXT,
  reported_by       TEXT,
  assigned_to       TEXT,
  inspection_id     TEXT REFERENCES public.sec_safety_inspections(id) ON DELETE SET NULL,
  identified_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMP WITH TIME ZONE,
  created_by        TEXT,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_hazards_prop ON public.sec_safety_hazards(property_id);
CREATE INDEX IF NOT EXISTS idx_sec_hazards_status ON public.sec_safety_hazards(status);
CREATE INDEX IF NOT EXISTS idx_sec_hazards_insp ON public.sec_safety_hazards(inspection_id);

CREATE OR REPLACE FUNCTION public.update_sec_hazards_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sec_hazards_updated_at ON public.sec_safety_hazards;
CREATE TRIGGER trigger_sec_hazards_updated_at
  BEFORE UPDATE ON public.sec_safety_hazards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sec_hazards_timestamp();

ALTER TABLE public.sec_safety_hazards ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_safety_hazards TO authenticated;

-- ── Seed data ────────────────────────────────────────────────────────────
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703).

INSERT INTO public.sec_safety_inspections
  (id, property_id, title, inspection_type, area, inspector, status,
   result, findings, scheduled_at, completed_at)
VALUES
  ('HSI-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Weekly Kitchen Hygiene Walkthrough',
   'Kitchen Hygiene', 'Main Kitchen', 'Safety Officer', 'Completed', 'Pass with Notes',
   'Overall compliant. Notes: grease trap due for cleaning; one cutting board needs replacement.',
   CURRENT_DATE - INTERVAL '4 days' + TIME '09:00', CURRENT_DATE - INTERVAL '4 days' + TIME '10:15'),
  ('HSI-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Pool Area Safety Inspection',
   'Pool Safety', 'Pool Deck', 'Safety Officer', 'Completed', 'Fail',
   'Depth markings faded on south edge; rescue ring line frayed; chemical storage cabinet latch broken.',
   CURRENT_DATE - INTERVAL '7 days' + TIME '08:00', CURRENT_DATE - INTERVAL '7 days' + TIME '09:00'),
  ('HSI-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Guest Floor Corridor Inspection — Floors 3-5',
   'Routine', 'Floors 3–5', 'Security Officer', 'Completed', 'Pass',
   'Corridors clear, exit signage illuminated, no obstructions.',
   CURRENT_DATE - INTERVAL '10 days' + TIME '11:00', CURRENT_DATE - INTERVAL '10 days' + TIME '12:00'),
  ('HSI-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Loading Dock Workplace Inspection',
   'Workplace', 'Loading Dock B2', 'Safety Officer', 'Completed', 'Pass with Notes',
   'PPE compliance good. Forklift charging cable routing creates minor trip hazard — flagged as HAZ-004.',
   CURRENT_DATE - INTERVAL '2 days' + TIME '14:00', CURRENT_DATE - INTERVAL '2 days' + TIME '15:00'),
  ('HSI-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Quarterly Compliance Inspection — Back of House',
   'Compliance', 'Back of House', 'External Auditor', 'Scheduled', NULL,
   'Full BOH compliance walkthrough with external auditor.',
   CURRENT_DATE + INTERVAL '5 days' + TIME '09:00', NULL),
  ('HSI-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Spa & Gym Equipment Inspection',
   'Routine', 'Spa / Fitness Center', 'Safety Officer', 'In Progress', NULL,
   'Inspecting cardio equipment, sauna temp controls, spa chemical logs.',
   CURRENT_DATE + TIME '13:00', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sec_safety_hazards
  (id, property_id, title, hazard_type, severity, status, location,
   description, corrective_action, reported_by, assigned_to,
   inspection_id, identified_at, resolved_at)
VALUES
  ('HAZ-001', '18762279-a389-41c9-9169-7ebc682e9703', 'Wet floor — Lobby entrance during rain',
   'Slip-Trip-Fall', 'High', 'Corrective Action', 'Lobby Entrance',
   'Rainwater tracked in creates slip hazard at main entrance during storms.',
   'Install additional matting; add hourly mop cycle during rain events; place caution signage.',
   'Front Desk', 'Housekeeping Supervisor', NULL,
   NOW() - INTERVAL '3 days', NULL),
  ('HAZ-002', '18762279-a389-41c9-9169-7ebc682e9703', 'Frayed rescue ring line — Pool',
   'Other', 'High', 'Resolved', 'Pool Deck',
   'Life ring throw line frayed beyond serviceable condition.',
   'Rescue ring replaced with new unit; spare added to pool equipment room.',
   'Safety Officer', 'Pool Attendant', 'HSI-002',
   NOW() - INTERVAL '7 days', NOW() - INTERVAL '5 days'),
  ('HAZ-003', '18762279-a389-41c9-9169-7ebc682e9703', 'Broken chemical cabinet latch — Pool plant',
   'Chemical', 'Critical', 'Resolved', 'Pool Plant Room',
   'Chemical storage cabinet latch broken — chlorine accessible to unauthorized staff.',
   'Latch replaced same day; cabinet re-keyed; access list updated.',
   'Safety Officer', 'Chief Engineer', 'HSI-002',
   NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days'),
  ('HAZ-004', '18762279-a389-41c9-9169-7ebc682e9703', 'Forklift charging cable — trip hazard',
   'Slip-Trip-Fall', 'Medium', 'Assessed', 'Loading Dock B2',
   'Charging cable crosses pedestrian walkway during forklift charging.',
   'Pending: cable ramp cover ordered; interim cones + tape in place.',
   'Safety Officer', 'Chief Engineer', 'HSI-004',
   NOW() - INTERVAL '2 days', NULL),
  ('HAZ-005', '18762279-a389-41c9-9169-7ebc682e9703', 'Faded pool depth markings',
   'Other', 'Medium', 'Corrective Action', 'Pool Deck South',
   'Depth markings illegible on south edge — guest safety + liability.',
   'Repainting scheduled with pool contractor this week.',
   'Safety Officer', 'Chief Engineer', 'HSI-002',
   NOW() - INTERVAL '7 days', NULL),
  ('HAZ-006', '18762279-a389-41c9-9169-7ebc682e9703', 'Blocked fire exit corridor — B1 storage',
   'Fire', 'Critical', 'Closed', 'B1 Storage Corridor',
   'Linens carts blocking secondary fire exit route.',
   'Corridor cleared immediately; storage SOP updated; staff retrained.',
   'Security Officer', 'Housekeeping Manager', NULL,
   NOW() - INTERVAL '14 days', NOW() - INTERVAL '13 days'),
  ('HAZ-007', '18762279-a389-41c9-9169-7ebc682e9703', 'Unguarded slicer blade — Kitchen',
   'Ergonomic', 'High', 'Reported', 'Main Kitchen',
   'Deli slicer guard missing after maintenance — laceration risk.',
   'Pending: replacement guard ordered; slicer tagged out of service.',
   'F&B Manager', NULL, NULL,
   NOW() - INTERVAL '6 hours', NULL)
ON CONFLICT (id) DO NOTHING;
