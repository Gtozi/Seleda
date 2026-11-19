-- 564 — RMS Dashboard metrics registry
--
-- The RMS Dashboard derives most KPIs live from existing rms_* tables
-- (inventory room types, BI revenue periods, demand forecasts, parity
-- issues, AI recommendations). A handful of index/assumption values that
-- were hardcoded in the old mock component ("would come from RMS API")
-- are moved here so they are database-driven and editable.

CREATE TABLE IF NOT EXISTS public.rms_dashboard_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID,
  metric_key    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT,
  value         NUMERIC NOT NULL,
  unit          TEXT,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_dashboard_metrics_key ON public.rms_dashboard_metrics (metric_key);

CREATE OR REPLACE FUNCTION public.trg_rms_dashboard_metrics_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rms_dashboard_metrics_updated ON public.rms_dashboard_metrics;
CREATE TRIGGER trg_rms_dashboard_metrics_updated BEFORE UPDATE ON public.rms_dashboard_metrics
  FOR EACH ROW EXECUTE FUNCTION public.trg_rms_dashboard_metrics_updated_at();

ALTER TABLE public.rms_dashboard_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_dash_metrics_read ON public.rms_dashboard_metrics;
CREATE POLICY rms_dash_metrics_read ON public.rms_dashboard_metrics FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_dash_metrics_write ON public.rms_dashboard_metrics;
CREATE POLICY rms_dash_metrics_write ON public.rms_dashboard_metrics FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

-- Seed the values that were hardcoded in the mock dashboard component
INSERT INTO public.rms_dashboard_metrics (metric_key, label, description, value, unit, display_order) VALUES
  ('market_penetration',       'Market Penetration',        'Share of captured demand vs competitive set',                        78,   'percent',   1),
  ('mpi',                      'Market Penetration Index',  'Occupancy index vs comp set (1.00 = fair share)',                      1.15, 'index',     2),
  ('rgci',                     'Revenue Generation Capacity Index', 'Revenue generation vs capacity (RGI-style)',                   1.08, 'index',     3),
  ('ancillary_ratio',          'Ancillary Revenue Ratio',   'Ancillary revenue as a fraction of room revenue',                      0.25, 'ratio',     4),
  ('goppar_ratio',             'GOPPAR Ratio',              'Gross operating profit as a fraction of RevPAR',                       0.35, 'ratio',     5),
  ('revenue_per_guest_factor', 'Revenue Per Guest Factor',  'In-stay spend multiplier applied to room rate',                        1.5,  'factor',    6),
  ('forecast_revenue_factor',  'Forecast Revenue Factor',   'Forecast uplift applied to total revenue',                             1.12, 'factor',    7)
ON CONFLICT (metric_key) DO NOTHING;
