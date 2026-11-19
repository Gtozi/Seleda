-- RMS Group Evaluation module.
-- Replaces hardcoded mock group inquiries and evaluation criteria in GroupEvaluation.tsx.

CREATE TABLE IF NOT EXISTS rms_group_inquiries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         UUID REFERENCES properties(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  company             TEXT NOT NULL,
  contact             TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  rooms               INTEGER NOT NULL DEFAULT 0,
  nights              INTEGER NOT NULL DEFAULT 0,
  check_in            DATE,
  check_out           DATE,
  proposed_rate       NUMERIC(12,2) NOT NULL DEFAULT 0,
  projected_revenue   NUMERIC(14,2) NOT NULL DEFAULT 0,
  profitability       NUMERIC(6,2) NOT NULL DEFAULT 0,
  space_utilization   NUMERIC(6,2) NOT NULL DEFAULT 0,
  recommendation      TEXT NOT NULL DEFAULT 'review',
  confidence          INTEGER NOT NULL DEFAULT 0,
  priority            TEXT NOT NULL DEFAULT 'medium',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rms_evaluation_criteria (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  weight          NUMERIC(6,2) NOT NULL DEFAULT 0,
  icon_name       TEXT,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_group_inq_status ON rms_group_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_rms_group_inq_company ON rms_group_inquiries(company);
CREATE INDEX IF NOT EXISTS idx_rms_eval_crit_order ON rms_evaluation_criteria(display_order);

CREATE OR REPLACE FUNCTION public.trg_rms_group_eval_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_group_inq_updated ON rms_group_inquiries;
CREATE TRIGGER trg_rms_group_inq_updated
  BEFORE UPDATE ON rms_group_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_group_eval_set_updated_at();

DROP TRIGGER IF EXISTS trg_rms_eval_crit_updated ON rms_evaluation_criteria;
CREATE TRIGGER trg_rms_eval_crit_updated
  BEFORE UPDATE ON rms_evaluation_criteria
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_group_eval_set_updated_at();

ALTER TABLE rms_group_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rms_evaluation_criteria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_group_inq_read ON rms_group_inquiries;
CREATE POLICY rms_group_inq_read ON rms_group_inquiries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_group_inq_write ON rms_group_inquiries;
CREATE POLICY rms_group_inq_write ON rms_group_inquiries FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

DROP POLICY IF EXISTS rms_eval_crit_read ON rms_evaluation_criteria;
CREATE POLICY rms_eval_crit_read ON rms_evaluation_criteria FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_eval_crit_write ON rms_evaluation_criteria;
CREATE POLICY rms_eval_crit_write ON rms_evaluation_criteria FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO rms_group_inquiries (name, company, contact, status, rooms, nights, check_in, check_out, proposed_rate, projected_revenue, profitability, space_utilization, recommendation, confidence, priority) VALUES
  ('Tech Conference 2024', 'TechCorp Inc', 'John Smith', 'pending', 50, 3, DATE '2024-12-15', DATE '2024-12-18', 145, 21750, 28, 75, 'accept', 85, 'high'),
  ('Annual Sales Meeting', 'SalesForce Global', 'Jane Doe', 'pending', 35, 2, DATE '2024-11-20', DATE '2024-11-22', 130, 9100, 32, 52, 'accept', 78, 'medium'),
  ('Wedding Block', 'Johnson Family', 'Sarah Johnson', 'pending', 20, 2, DATE '2024-10-10', DATE '2024-10-12', 160, 6400, 35, 30, 'accept', 92, 'low'),
  ('Sports Team Retreat', 'City FC', 'Mike Brown', 'pending', 45, 4, DATE '2024-12-28', DATE '2025-01-01', 110, 19800, 18, 67, 'reject', 72, 'high')
ON CONFLICT DO NOTHING;

INSERT INTO rms_evaluation_criteria (title, description, weight, icon_name, display_order) VALUES
  ('Revenue Projection', 'Estimated total revenue from group booking', 30, 'DollarSign', 1),
  ('Profitability', 'Net profit margin after costs', 25, 'TrendingUp', 2),
  ('Space Utilization', 'Percentage of total inventory utilized', 25, 'Bed', 3),
  ('Date Strategic Value', 'Impact on high-demand periods', 20, 'Calendar', 4)
ON CONFLICT DO NOTHING;
