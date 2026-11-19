-- ============================================================
-- Engineering Portal — Energy Management (Migration 328)
-- ============================================================
-- Adds three tables for the /erp/maintenance/energy tab:
--   1. energy_metrics — daily consumption (electricity, water, gas,
--      diesel, solar, total cost, carbon footprint).
--   2. energy_equipment_efficiency — real-time equipment efficiency
--      monitoring (current vs target %, status).
--   3. energy_projects — capital energy-saving projects with ROI
--      tracking.
--
-- Seeds the mock rows that were previously hardcoded in
-- EnergyManagement.tsx useState.
--
-- RLS enabled on all three; authenticated role granted CRUD.
-- Uses the demo property (18762279-a389-41c9-9169-7ebc682e9703)
-- for multi-property scoping via the property_id column.
-- ============================================================

-- ── 1. energy_metrics ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.energy_metrics (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  metric_date date NOT NULL,
  electricity_kwh numeric(18,2) NOT NULL DEFAULT 0,
  water_liters numeric(18,2) NOT NULL DEFAULT 0,
  gas_m3 numeric(18,2) NOT NULL DEFAULT 0,
  diesel_liters numeric(18,2) NOT NULL DEFAULT 0,
  solar_kwh numeric(18,2) NOT NULL DEFAULT 0,
  total_cost numeric(18,2) NOT NULL DEFAULT 0,
  carbon_footprint_tons numeric(18,2) NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_energy_metrics_property_id ON public.energy_metrics(property_id);
CREATE INDEX IF NOT EXISTS idx_energy_metrics_date ON public.energy_metrics(metric_date);

-- ── 2. energy_equipment_efficiency ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.energy_equipment_efficiency (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  equipment_name text NOT NULL,
  category text NOT NULL,
  current_efficiency numeric(5,2) NOT NULL DEFAULT 0,
  target_efficiency numeric(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Optimal' CHECK (status IN ('Optimal', 'Warning', 'Critical')),
  last_measured date,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_energy_eff_property_id ON public.energy_equipment_efficiency(property_id);
CREATE INDEX IF NOT EXISTS idx_energy_eff_status ON public.energy_equipment_efficiency(status);

-- ── 3. energy_projects ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.energy_projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id uuid,
  ep_number text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('LED Upgrade', 'HVAC Optimization', 'Solar Installation', 'Insulation', 'Variable Speed Drives')),
  status text NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned', 'In Progress', 'Completed')),
  estimated_savings numeric(18,2) NOT NULL DEFAULT 0,
  actual_savings numeric(18,2),
  investment numeric(18,2) NOT NULL DEFAULT 0,
  roi numeric(8,2) NOT NULL DEFAULT 0,
  completion_date date,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_energy_projects_property_id ON public.energy_projects(property_id);
CREATE INDEX IF NOT EXISTS idx_energy_projects_status ON public.energy_projects(status);

-- ── Updated-at triggers ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at_energy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_energy_metrics ON public.energy_metrics;
CREATE TRIGGER trg_set_updated_at_energy_metrics
  BEFORE UPDATE ON public.energy_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_energy();

DROP TRIGGER IF EXISTS trg_set_updated_at_energy_eff ON public.energy_equipment_efficiency;
CREATE TRIGGER trg_set_updated_at_energy_eff
  BEFORE UPDATE ON public.energy_equipment_efficiency
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_energy();

DROP TRIGGER IF EXISTS trg_set_updated_at_energy_projects ON public.energy_projects;
CREATE TRIGGER trg_set_updated_at_energy_projects
  BEFORE UPDATE ON public.energy_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_energy();

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.energy_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD energy_metrics"
  ON public.energy_metrics FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.energy_metrics TO authenticated;

ALTER TABLE public.energy_equipment_efficiency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD energy_equipment_efficiency"
  ON public.energy_equipment_efficiency FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.energy_equipment_efficiency TO authenticated;

ALTER TABLE public.energy_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD energy_projects"
  ON public.energy_projects FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.energy_projects TO authenticated;

-- ── Seed: energy_metrics (3 rows) ────────────────────────────────
INSERT INTO public.energy_metrics (
  property_id, metric_date, electricity_kwh, water_liters, gas_m3, diesel_liters, solar_kwh, total_cost, carbon_footprint_tons
) VALUES
('18762279-a389-41c9-9169-7ebc682e9703', '2026-07-29', 1250, 450, 320, 150, 280, 2450, 1.8),
('18762279-a389-41c9-9169-7ebc682e9703', '2026-07-28', 1180, 420, 300, 140, 260, 2300, 1.7),
('18762279-a389-41c9-9169-7ebc682e9703', '2026-07-27', 1320, 480, 340, 160, 290, 2590, 1.9)
ON CONFLICT DO NOTHING;

-- ── Seed: energy_equipment_efficiency (4 rows) ───────────────────
INSERT INTO public.energy_equipment_efficiency (
  property_id, equipment_name, category, current_efficiency, target_efficiency, status, last_measured
) VALUES
('18762279-a389-41c9-9169-7ebc682e9703', 'Central Chiller Unit', 'HVAC', 78, 85, 'Warning', '2026-07-28'),
('18762279-a389-41c9-9169-7ebc682e9703', 'Backup Generator', 'Power Systems', 92, 90, 'Optimal', '2026-07-29'),
('18762279-a389-41c9-9169-7ebc682e9703', 'Water Booster Pumps', 'Water Systems', 65, 80, 'Critical', '2026-07-27'),
('18762279-a389-41c9-9169-7ebc682e9703', 'Steam Boiler 02', 'HVAC', 88, 85, 'Optimal', '2026-07-28')
ON CONFLICT DO NOTHING;

-- ── Seed: energy_projects (4 rows) ───────────────────────────────
INSERT INTO public.energy_projects (
  property_id, ep_number, name, type, status, estimated_savings, actual_savings, investment, roi, completion_date
) VALUES
('18762279-a389-41c9-9169-7ebc682e9703', 'EP-2026-001', 'LED Lighting Upgrade - Guest Rooms', 'LED Upgrade', 'Completed', 15000, 16500, 45000, 36.7, '2026-06-15'),
('18762279-a389-41c9-9169-7ebc682e9703', 'EP-2026-002', 'HVAC VSD Installation', 'Variable Speed Drives', 'In Progress', 22000, NULL, 65000, 33.8, NULL),
('18762279-a389-41c9-9169-7ebc682e9703', 'EP-2026-003', 'Solar Panel Array - Rooftop', 'Solar Installation', 'Planned', 35000, NULL, 120000, 29.2, NULL),
('18762279-a389-41c9-9169-7ebc682e9703', 'EP-2026-004', 'Building Insulation Upgrade', 'Insulation', 'Planned', 18000, NULL, 55000, 32.7, NULL)
ON CONFLICT (ep_number) DO NOTHING;
