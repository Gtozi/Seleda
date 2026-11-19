-- ============================================================
-- 646_exec_strategic_items.sql
-- User-authored strategic planning items for
-- /erp/executive/strategic-planning
-- ============================================================
-- The Strategic Planning module previously only rendered items
-- derived from operational tables (budget_forecasts, fin_bi_forecasts,
-- eng_projects, ...). Those are read-only rollups — there was no way
-- to author an actual plan/OKR/KPI target. This table stores
-- user-authored items which the endpoint merges with derived items
-- (flagged `custom: true` so the UI can offer edit/delete).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exec_strategic_items (
  id            TEXT PRIMARY KEY DEFAULT 'strat_' || gen_random_uuid()::text,
  property_id   UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  category      TEXT NOT NULL CHECK (category IN (
                  'business_plan','objectives','okrs','kpi_targets',
                  'department_goals','capital_projects','growth')),
  department    TEXT,
  owner         TEXT,
  -- Target tracking: when target_value > 0 the endpoint derives
  -- progress = current_value / target_value; otherwise `progress`
  -- is managed manually.
  target_value  NUMERIC,
  current_value NUMERIC DEFAULT 0,
  unit          TEXT DEFAULT '%',
  metric        TEXT DEFAULT 'completion' CHECK (metric IN (
                  'completion','attainment','confidence','utilization',
                  'adherence','elapsed','pipeline')),
  progress      NUMERIC DEFAULT 0,
  status        TEXT DEFAULT 'on_track' CHECK (status IN (
                  'on_track','at_risk','behind','completed')),
  start_date    DATE,
  due_date      DATE,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exec_strategic_items_property ON public.exec_strategic_items(property_id);
CREATE INDEX IF NOT EXISTS idx_exec_strategic_items_category ON public.exec_strategic_items(category);
CREATE INDEX IF NOT EXISTS idx_exec_strategic_items_due      ON public.exec_strategic_items(due_date);

ALTER TABLE public.exec_strategic_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exec_strategic_items TO authenticated;

DROP POLICY IF EXISTS "authenticated can CRUD exec_strategic_items" ON public.exec_strategic_items;
CREATE POLICY "authenticated can CRUD exec_strategic_items" ON public.exec_strategic_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed a few authored items for the demo property (things the derived
-- sources cannot produce — real forward-looking plans).
DO $$
DECLARE
  prop_id UUID := '18762279-a389-41c9-9169-7ebc682e9703';
BEGIN
  IF EXISTS (SELECT 1 FROM public.properties WHERE id = prop_id) THEN
    INSERT INTO public.exec_strategic_items
      (id, property_id, title, description, category, department, owner,
       target_value, current_value, unit, metric, status, start_date, due_date, created_by)
    VALUES
      ('strat_seed_001', prop_id,
       'FY2026 Direct Booking Growth Plan',
       'Grow direct bookings to 40% of room revenue via the loyalty programme and website conversion funnel.',
       'business_plan', 'Sales & Marketing', 'Commercial Director',
       40, 27, '%', 'attainment', 'on_track', '2026-01-01', '2026-12-31', 'system'),
      ('strat_seed_002', prop_id,
       'Achieve Green Globe Certification',
       'Complete environmental certification audit and close all corrective actions.',
       'objectives', 'Sustainability', 'Sustainability Manager',
       100, 65, '%', 'completion', 'at_risk', '2026-03-01', '2026-11-30', 'system'),
      ('strat_seed_003', prop_id,
       'Reduce Housekeeping Turnover Below 15%',
       'Annualized HK staff turnover — retention programme, cross-training, and shift flexibility.',
       'okrs', 'Housekeeping', 'HK Director',
       15, 22, '%', 'attainment', 'at_risk', '2026-01-01', '2026-12-31', 'system'),
      ('strat_seed_004', prop_id,
       'Guest Satisfaction Score ≥ 4.6',
       'Rolling 90-day guest satisfaction across review platforms.',
       'kpi_targets', 'Front Office', 'Front Office Manager',
       4.6, 4.4, '/5', 'attainment', 'on_track', NULL, NULL, 'system'),
      ('strat_seed_005', prop_id,
       'Second Outlet Feasibility Study',
       'Evaluate converting the lobby lounge into a specialty coffee outlet — capex, ROI, staffing model.',
       'growth', 'Food & Beverage', 'F&B Director',
       NULL, NULL, '%', 'pipeline', 'on_track', '2026-06-01', '2026-10-15', 'system')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
