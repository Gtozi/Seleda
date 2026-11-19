-- Migration 642: Operations Reports registry
-- Backs /erp/operations/reports (Reports.tsx). Mimics hk_reports
-- (migration 316) — a registry of report definitions with run metadata.
-- `summary` JSONB stores headline live metrics computed at each run.

CREATE TABLE IF NOT EXISTS public.ops_reports (
  id          TEXT PRIMARY KEY,
  property_id UUID,
  category    TEXT NOT NULL CHECK (category IN ('operations','guest','approval','executive')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   TEXT NOT NULL DEFAULT 'Daily',
  format      TEXT NOT NULL DEFAULT 'PDF' CHECK (format IN ('PDF','Excel','CSV')),
  status      TEXT NOT NULL DEFAULT 'Ready' CHECK (status IN ('Ready','Scheduled','Generating','Failed')),
  last_run    TIMESTAMPTZ,
  summary     JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ops_reports_auth ON public.ops_reports;
CREATE POLICY ops_reports_auth ON public.ops_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_reports TO service_role;

-- Seed: the former mock report definitions.
INSERT INTO public.ops_reports (id, category, name, description, frequency, format, status) VALUES
  ('ops-rpt-01', 'operations', 'Daily Operations Summary',     'Summary of daily operational activities across all departments',  'Daily',    'PDF',   'Ready'),
  ('ops-rpt-02', 'operations', 'Shift Report',                 'Detailed shift-by-shift operational report',                      'Per Shift','PDF',   'Ready'),
  ('ops-rpt-03', 'operations', 'Department Status',            'Current status of all hotel departments',                         'Daily',    'Excel', 'Ready'),
  ('ops-rpt-04', 'operations', 'Cross-Department Tasks',       'Status of tasks involving multiple departments',                  'Daily',    'PDF',   'Ready'),
  ('ops-rpt-05', 'operations', 'SLA Compliance',               'Service Level Agreement compliance report',                       'Weekly',   'Excel', 'Ready'),
  ('ops-rpt-06', 'guest',      'VIP Report',                   'VIP guest activity and special requests',                         'Daily',    'PDF',   'Ready'),
  ('ops-rpt-07', 'guest',      'Guest Recovery Report',        'Service recovery cases and resolutions',                          'Daily',    'Excel', 'Ready'),
  ('ops-rpt-08', 'guest',      'Complaint Report',             'Guest complaints and resolution status',                          'Daily',    'PDF',   'Ready'),
  ('ops-rpt-09', 'guest',      'Service Quality Report',       'Guest satisfaction and service quality metrics',                  'Weekly',   'Excel', 'Ready'),
  ('ops-rpt-10', 'approval',   'Pending Approvals',            'Current pending approval requests',                               'Daily',    'PDF',   'Ready'),
  ('ops-rpt-11', 'approval',   'Approval Turnaround Time',     'Analysis of approval processing times',                           'Weekly',   'Excel', 'Ready'),
  ('ops-rpt-12', 'approval',   'Escalation Report',            'Escalated items and resolution status',                           'Daily',    'PDF',   'Ready'),
  ('ops-rpt-13', 'executive',  'Hotel Status',                 'Overall hotel operational status',                                'Daily',    'PDF',   'Ready'),
  ('ops-rpt-14', 'executive',  'Department Performance',       'Performance metrics by department',                               'Weekly',   'Excel', 'Ready'),
  ('ops-rpt-15', 'executive',  'Daily Flash',                  'Executive daily flash report',                                    'Daily',    'PDF',   'Ready'),
  ('ops-rpt-16', 'executive',  'Weekly Operations Review',     'Weekly operational performance review',                           'Weekly',   'Excel', 'Ready'),
  ('ops-rpt-17', 'executive',  'Monthly Operations Review',    'Monthly operational performance review',                          'Monthly',  'Excel', 'Ready')
ON CONFLICT (id) DO NOTHING;
