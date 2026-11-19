-- ============================================================
-- Engineering Portal — Projects & Renovations (Migration 334)
-- ============================================================
-- Backs the /erp/maintenance/projects-renovations tab
-- (ProjectsRenovations.tsx). Previously the module rendered
-- hardcoded mock data in useState. This migration persists that
-- contract to the DB so the module can fetch/persist via
-- /api/eng-portal/projects.
--
-- A project is a capital project / renovation / construction
-- initiative. It flows:
--   Planning → Approved → In Progress → (Completed | On Hold | Cancelled)
-- Each project has an optional set of phases (stored in a child
-- table eng_project_phases) for granular stage tracking.
-- ============================================================

-- ── Main table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_projects (
  id                       TEXT PRIMARY KEY,
  property_id              UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  prj_number               TEXT NOT NULL,
  name                     TEXT NOT NULL,
  type                     TEXT NOT NULL CHECK (type IN (
                             'Renovation', 'Upgrade', 'New Construction',
                             'Refurbishment', 'Expansion'
                           )),
  category                 TEXT NOT NULL CHECK (category IN (
                             'Guest Rooms', 'Public Areas', 'Kitchen',
                             'Exterior', 'Infrastructure', 'Energy Efficiency'
                           )),
  location                 TEXT NOT NULL,
  description              TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Planning' CHECK (status IN (
                             'Planning', 'Approved', 'In Progress', 'On Hold',
                             'Completed', 'Cancelled'
                           )),
  priority                 TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN (
                             'Critical', 'High', 'Normal', 'Low'
                           )),
  start_date               DATE,
  target_completion_date   DATE,
  actual_completion_date   DATE,
  project_manager          TEXT,
  budget                   NUMERIC(18,2) NOT NULL DEFAULT 0,
  spent                    NUMERIC(18,2) NOT NULL DEFAULT 0,
  progress                 INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  approved_at              TIMESTAMPTZ,
  in_progress_at           TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  on_hold_at               TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  created_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_projects_property
  ON public.eng_projects(property_id);
CREATE INDEX IF NOT EXISTS idx_eng_projects_status
  ON public.eng_projects(status);
CREATE INDEX IF NOT EXISTS idx_eng_projects_type
  ON public.eng_projects(type);
CREATE INDEX IF NOT EXISTS idx_eng_projects_category
  ON public.eng_projects(category);
CREATE INDEX IF NOT EXISTS idx_eng_projects_priority
  ON public.eng_projects(priority);

-- ── Phases child table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_project_phases (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id      TEXT NOT NULL REFERENCES public.eng_projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (
                    'Pending', 'In Progress', 'Completed', 'On Hold'
                  )),
  completed_date  DATE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eng_project_phases_project
  ON public.eng_project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_eng_project_phases_sort
  ON public.eng_project_phases(project_id, sort_order);

-- ── updated_at triggers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_eng_projects_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_projects_updated_at ON public.eng_projects;
CREATE TRIGGER trg_eng_projects_updated_at
  BEFORE UPDATE ON public.eng_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_projects_timestamp();

CREATE OR REPLACE FUNCTION public.update_eng_project_phases_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_project_phases_updated_at ON public.eng_project_phases;
CREATE TRIGGER trg_eng_project_phases_updated_at
  BEFORE UPDATE ON public.eng_project_phases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_eng_project_phases_timestamp();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.eng_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_projects"
  ON public.eng_projects FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_projects TO authenticated;

ALTER TABLE public.eng_project_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_project_phases"
  ON public.eng_project_phases FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_project_phases TO authenticated;

-- ── Seed mock data ───────────────────────────────────────────────────────
-- The 5 projects previously hardcoded as useState initial state in
-- ProjectsRenovations.tsx. Uses the single demo property
-- (18762279-a389-41c9-9169-7ebc682e9703).
INSERT INTO public.eng_projects
  (id, property_id, prj_number, name, type, category, location, description,
   status, priority, start_date, target_completion_date, actual_completion_date,
   project_manager, budget, spent, progress)
VALUES
  ('PRJ-001', '18762279-a389-41c9-9169-7ebc682e9703', 'PRJ-2026-001',
   'Guest Room Renovation - Floor 3', 'Renovation', 'Guest Rooms', 'Floor 3',
   'Complete renovation of 20 guest rooms including flooring, furniture, and bathroom upgrades.',
   'In Progress', 'High', '2026-06-01', '2026-09-30', NULL,
   'John Project Manager', 250000, 150000, 60),
  ('PRJ-002', '18762279-a389-41c9-9169-7ebc682e9703', 'PRJ-2026-002',
   'Lobby Modernization', 'Upgrade', 'Public Areas', 'Main Lobby',
   'Modernize main lobby with new reception desk, lighting, and seating areas.',
   'Planning', 'Normal', '2026-09-01', '2026-12-15', NULL,
   'Sarah Project Manager', 180000, 0, 0),
  ('PRJ-003', '18762279-a389-41c9-9169-7ebc682e9703', 'PRJ-2026-003',
   'Kitchen Equipment Upgrade', 'Upgrade', 'Kitchen', 'Main Kitchen',
   'Replace aging kitchen equipment with energy-efficient models.',
   'Approved', 'High', '2026-08-15', '2026-10-30', NULL,
   'Michael Project Manager', 120000, 0, 0),
  ('PRJ-004', '18762279-a389-41c9-9169-7ebc682e9703', 'PRJ-2026-004',
   'Solar Panel Installation', 'New Construction', 'Energy Efficiency', 'Rooftop',
   'Install 100kW solar panel array for renewable energy generation.',
   'In Progress', 'Critical', '2026-05-01', '2026-08-30', NULL,
   'David Project Manager', 350000, 280000, 80),
  ('PRJ-005', '18762279-a389-41c9-9169-7ebc682e9703', 'PRJ-2026-005',
   'Parking Lot Resurfacing', 'Refurbishment', 'Exterior', 'Main Parking Lot',
   'Resurface parking lot and install new LED lighting.',
   'Completed', 'Normal', '2026-04-01', '2026-06-30', '2026-06-25',
   'Lisa Project Manager', 85000, 82000, 100)
ON CONFLICT (id) DO NOTHING;

-- ── Seed phases for PRJ-001 and PRJ-004 ──────────────────────────────────
INSERT INTO public.eng_project_phases (id, project_id, name, status, completed_date, sort_order)
VALUES
  ('PRJ-001-PH-1', 'PRJ-001', 'Demolition',     'Completed',   '2026-06-15', 1),
  ('PRJ-001-PH-2', 'PRJ-001', 'Electrical',     'Completed',   '2026-07-01', 2),
  ('PRJ-001-PH-3', 'PRJ-001', 'Plumbing',       'In Progress', NULL,         3),
  ('PRJ-001-PH-4', 'PRJ-001', 'Finishing',      'Pending',     NULL,         4),
  ('PRJ-004-PH-1', 'PRJ-004', 'Structural Assessment', 'Completed',   '2026-05-15', 1),
  ('PRJ-004-PH-2', 'PRJ-004', 'Panel Installation',    'Completed',   '2026-07-15', 2),
  ('PRJ-004-PH-3', 'PRJ-004', 'Grid Connection',        'In Progress', NULL,         3),
  ('PRJ-004-PH-4', 'PRJ-004', 'Testing',                'Pending',     NULL,         4)
ON CONFLICT (id) DO NOTHING;
