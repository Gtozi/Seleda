-- Migration 641: Daily Flash Reports persistence
-- Backs /erp/operations/flash-reports (DailyFlashReports.tsx).
--
-- ops_flash_reports stores generated report snapshots: the route computes
-- a live cross-portal operational snapshot (occupancy, revenue, HK,
-- maintenance, guest experience, safety, events, escalations) and persists
-- the section subset for the chosen report type in `payload`.

CREATE TABLE IF NOT EXISTS public.ops_flash_reports (
  id            TEXT PRIMARY KEY,
  property_id   UUID,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  period_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  generated_by  TEXT,
  status        TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','generating','failed')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_flash_reports_property ON public.ops_flash_reports (property_id, created_at DESC);

ALTER TABLE public.ops_flash_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_flash_reports_auth ON public.ops_flash_reports;
CREATE POLICY ops_flash_reports_auth ON public.ops_flash_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_flash_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_flash_reports TO service_role;
