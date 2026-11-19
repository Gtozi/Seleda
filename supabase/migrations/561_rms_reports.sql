-- RMS Reports registry.
-- Backs the /erp/revenue/reports screen. Mimics the Housekeeping reports
-- pattern (hk_reports / housekeepingPortal.routes.ts / HKReportsModule.tsx).
-- Each row is a report definition with last-run timestamp, status, output
-- format, and generation frequency. Run / Run All / Schedule persist back.
--
-- Status values:   Ready | Scheduled | Generating | Failed
-- Format values:   PDF | Excel | CSV
-- Category values: revenue | occupancy | adr | revpar | channel | segment | custom

CREATE TABLE IF NOT EXISTS public.rms_reports (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('revenue','occupancy','adr','revpar','channel','segment','custom')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  last_run    TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Ready','Scheduled','Generating','Failed')),
  format      TEXT NOT NULL DEFAULT 'PDF' CHECK (format IN ('PDF','Excel','CSV')),
  frequency   TEXT NOT NULL DEFAULT '',
  property_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rms_reports_category ON public.rms_reports(category);
CREATE INDEX IF NOT EXISTS idx_rms_reports_status ON public.rms_reports(status);

CREATE OR REPLACE FUNCTION public.rms_reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rms_reports_updated_at ON public.rms_reports;
CREATE TRIGGER trg_rms_reports_updated_at
  BEFORE UPDATE ON public.rms_reports
  FOR EACH ROW EXECUTE FUNCTION public.rms_reports_set_updated_at();

ALTER TABLE public.rms_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_reports_read ON public.rms_reports;
CREATE POLICY rms_reports_read ON public.rms_reports FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_reports_write ON public.rms_reports;
CREATE POLICY rms_reports_write ON public.rms_reports FOR ALL TO authenticated
  USING ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'))
  WITH CHECK ((SELECT auth.jwt()) -> 'app_metadata' ->> 'role' IN ('revenue_manager','revenue','admin','system_admin','superuser','owner','executive','general_manager','gm'));

INSERT INTO public.rms_reports (id, category, name, description, last_run, status, format, frequency)
SELECT * FROM (VALUES
  ('rms-daily-revenue'::text,       'revenue'::text,  'Daily Revenue Report'::text,       'Day-by-day revenue breakdown with segment analysis.'::text,        '2024-01-28'::timestamptz, 'Ready'::text,     'PDF'::text,   'Daily 08:00'::text),
  ('rms-monthly-revenue',           'revenue',        'Monthly Revenue Summary',          'Monthly revenue trends and YoY comparison.',                       '2024-01-25',              'Ready',          'Excel',       '1st of month'),
  ('rms-occupancy-analysis',        'occupancy',      'Occupancy Analysis',               'Room occupancy by type and channel.',                              '2024-01-28',              'Ready',          'PDF',         'Monday 09:00'),
  ('rms-adr-performance',           'adr',            'ADR Performance Report',           'Average daily rate by segment and channel.',                       '2024-01-27',              'Ready',          'Excel',       'Monday 09:30'),
  ('rms-revpar-dashboard',          'revpar',         'RevPAR Dashboard',                 'Revenue per available room analysis.',                             '2024-01-28',              'Ready',          'PDF',         'Daily 08:30'),
  ('rms-channel-performance',       'channel',        'Channel Performance',              'Revenue and booking analysis by distribution channel.',            '2024-01-26',              'Ready',          'Excel',       '1st of month'),
  ('rms-market-segment',            'segment',        'Market Segment Report',            'Revenue and occupancy by market segment.',                         '2024-01-25',              'Scheduled',      'PDF',         '1st of month'),
  ('rms-custom-pricing',            'custom',         'Custom Pricing Analysis',          'Custom report for executive review.',                              '2024-01-20',              'Scheduled',      'PDF',         'On-demand')
) AS t(id, category, name, description, last_run, status, format, frequency)
WHERE NOT EXISTS (SELECT 1 FROM public.rms_reports WHERE id = t.id);
