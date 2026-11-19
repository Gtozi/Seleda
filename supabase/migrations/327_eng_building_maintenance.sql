-- ============================================================
-- Engineering Portal — Building Maintenance (Migration 327)
-- ============================================================
-- Adds the public.building_maintenance_tasks table for the
-- /erp/maintenance/building-maintenance tab, and seeds the 8 mock
-- rows that were previously hardcoded in BuildingMaintenance.tsx
-- useState.
--
-- Lifecycle: Scheduled → In Progress → Completed (+ On Hold / Cancelled side-branches)
-- Areas: Guest Rooms, Public Areas, Roof, Exterior, Parking,
--        Landscaping, Water Systems, Electrical Systems, Mechanical Systems
-- Priorities: Emergency, High, Normal, Low
--
-- RLS enabled; authenticated role granted CRUD.
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703)
-- for multi-property scoping via the property_id column.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.building_maintenance_tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  bm_number text NOT NULL UNIQUE,
  area text NOT NULL CHECK (area IN (
    'Guest Rooms', 'Public Areas', 'Roof', 'Exterior', 'Parking',
    'Landscaping', 'Water Systems', 'Electrical Systems', 'Mechanical Systems'
  )),
  location text,
  task_type text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Emergency', 'High', 'Normal', 'Low')),
  status text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'In Progress', 'Completed', 'On Hold', 'Cancelled')),
  assigned_to text,
  scheduled_date date NOT NULL,
  estimated_cost numeric(18,2),
  actual_cost numeric(18,2),
  completion_date date,
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bm_tasks_property_id ON public.building_maintenance_tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_bm_tasks_status ON public.building_maintenance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_bm_tasks_area ON public.building_maintenance_tasks(area);
CREATE INDEX IF NOT EXISTS idx_bm_tasks_priority ON public.building_maintenance_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_bm_tasks_scheduled_date ON public.building_maintenance_tasks(scheduled_date);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at_bm()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_bm ON public.building_maintenance_tasks;
CREATE TRIGGER trg_set_updated_at_bm
  BEFORE UPDATE ON public.building_maintenance_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_bm();

-- RLS
ALTER TABLE public.building_maintenance_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD building maintenance tasks"
  ON public.building_maintenance_tasks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_maintenance_tasks TO authenticated;

-- Seed the 8 mock rows
INSERT INTO public.building_maintenance_tasks (
  property_id, bm_number, area, location, task_type, description,
  priority, status, assigned_to, scheduled_date, estimated_cost, actual_cost, completion_date, notes
) VALUES
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-001', 'Guest Rooms', 'Room 205-210', 'Painting',
  'Repaint guest rooms 205-210 as part of quarterly refresh cycle.',
  'Normal', 'In Progress', 'Painting Team A', '2026-07-25', 2500.00, NULL, NULL, NULL
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-002', 'Public Areas', 'Lobby Floor', 'Flooring',
  'Replace damaged marble tiles in main lobby entrance area.',
  'High', 'Scheduled', 'Flooring Specialist', '2026-08-01', 1800.00, NULL, NULL, NULL
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-003', 'Roof', 'Rooftop Main', 'Waterproofing',
  'Apply waterproof coating to roof membrane. Annual maintenance.',
  'Normal', 'Scheduled', 'External Contractor', '2026-08-15', 3500.00, NULL, NULL, NULL
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-004', 'Exterior', 'Building Facade', 'Cleaning',
  'Pressure wash and clean building exterior facade.',
  'Low', 'Completed', 'Cleaning Services', '2026-07-20', 800.00, 750.00, '2026-07-22',
  'Completed successfully. No issues found.'
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-005', 'Parking', 'Main Parking Lot', 'Lighting',
  'Replace damaged LED light poles in parking lot sections B and C.',
  'High', 'In Progress', 'Electrical Team', '2026-07-28', 1200.00, NULL, NULL, NULL
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-006', 'Landscaping', 'Garden Areas', 'Irrigation',
  'Repair broken sprinkler heads in main garden area.',
  'Normal', 'Completed', 'Landscaping Team', '2026-07-18', 400.00, 380.00, '2026-07-19', NULL
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-007', 'Water Systems', 'Main Water Tank', 'Inspection',
  'Annual water tank inspection and cleaning.',
  'High', 'Scheduled', 'Plumbing Team', '2026-08-05', 600.00, NULL, NULL, NULL
),
(
  '18762279-a389-41c9-9169-7ebc682e9703', 'BM-2026-008', 'Electrical Systems', 'Distribution Panels', 'Maintenance',
  'Quarterly electrical panel inspection and thermal imaging.',
  'Normal', 'Scheduled', 'Electrical Team', '2026-08-10', 500.00, NULL, NULL, NULL
)
ON CONFLICT (bm_number) DO NOTHING;
