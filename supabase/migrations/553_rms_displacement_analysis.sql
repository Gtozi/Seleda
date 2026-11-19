-- RMS Displacement Analysis module.
-- Replaces hardcoded mock scenarios and formulas in DisplacementAnalysis.tsx.

CREATE TABLE IF NOT EXISTS rms_displacement_scenarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID REFERENCES properties(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  dates               TEXT NOT NULL,
  rooms               INTEGER NOT NULL DEFAULT 0,
  nights              INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',
  revenue_lost        NUMERIC(14,2) NOT NULL DEFAULT 0,
  revenue_gained      NUMERIC(14,2) NOT NULL DEFAULT 0,
  opportunity_cost    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ancillary_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_profitability NUMERIC(14,2) NOT NULL DEFAULT 0,
  recommendation      TEXT NOT NULL DEFAULT 'review',
  confidence          INTEGER NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_displacement_formula (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  formula         TEXT NOT NULL,
  description     TEXT,
  example         TEXT,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_disp_scen_status ON rms_displacement_scenarios(status);
CREATE INDEX IF NOT EXISTS idx_rms_disp_formula_order ON rms_displacement_formula(display_order);

CREATE OR REPLACE FUNCTION public.trg_rms_displacement_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_disp_scen_updated ON rms_displacement_scenarios;
CREATE TRIGGER trg_rms_disp_scen_updated
  BEFORE UPDATE ON rms_displacement_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_displacement_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_disp_formula_updated ON rms_displacement_formula;
CREATE TRIGGER trg_rms_disp_formula_updated
  BEFORE UPDATE ON rms_displacement_formula
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_displacement_set_updated_at();

ALTER TABLE rms_displacement_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_displacement_formula ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_disp_scen_read ON rms_displacement_scenarios;
CREATE POLICY rms_disp_scen_read ON rms_displacement_scenarios FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_disp_scen_write ON rms_displacement_scenarios;
CREATE POLICY rms_disp_scen_write ON rms_displacement_scenarios FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_disp_formula_read ON rms_displacement_formula;
CREATE POLICY rms_disp_formula_read ON rms_displacement_formula FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_disp_formula_write ON rms_displacement_formula;
CREATE POLICY rms_disp_formula_write ON rms_displacement_formula FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_displacement_scenarios (name, dates, rooms, nights, status, revenue_lost, revenue_gained, opportunity_cost, ancillary_revenue, total_profitability, recommendation, confidence, active) VALUES
  ('Tech Conference Group', '2024-12-15 to 2024-12-18', 50, 3, 'pending', 22500, 21750, 3500, 4200, -750, 'reject', 78, true),
  ('Corporate Retreat', '2024-11-20 to 2024-11-22', 35, 2, 'pending', 8400, 9100, 1200, 1800, 1300, 'accept', 85, true),
  ('Holiday Season Group', '2024-12-24 to 2024-12-26', 40, 2, 'pending', 18000, 12800, 5800, 2400, -8600, 'reject', 92, true)
ON CONFLICT DO NOTHING;

INSERT INTO rms_displacement_formula (title, formula, description, example, display_order) VALUES
  ('Revenue Lost', 'Transient Rate × Rooms × Nights', 'Revenue that would be generated from transient guests displaced by group booking', '$150 × 50 × 3 = $22,500', 1),
  ('Revenue Gained', 'Group Rate × Rooms × Nights', 'Revenue generated from the group booking', '$145 × 50 × 3 = $21,750', 2),
  ('Opportunity Cost', 'Revenue Lost - Revenue Gained', 'Net revenue difference between displaced transient and group booking', '$22,500 - $21,750 = $750', 3),
  ('Total Profitability', 'Revenue Gained + Ancillary Revenue - Opportunity Cost', 'Final profitability including ancillary revenue from group', '$21,750 + $4,200 - $750 = $25,200', 4)
ON CONFLICT DO NOTHING;
