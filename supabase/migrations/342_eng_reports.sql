-- ============================================================
-- Engineering Portal — Reports Registry (Migration 342)
-- ============================================================
-- Backs the /erp/maintenance/reports screen. Replaces the generic
-- DepartmentReportsModule with a dedicated Engineering reports
-- registry, mimicking the Housekeeping reports pattern
-- (hk_reports / housekeepingPortal.routes.ts / HKReportsModule.tsx).
--
-- Each row is a report definition with its last-run timestamp,
-- status, output format, and generation frequency. Run / Run All /
-- Schedule actions persist back to this table.
--
-- Status values:   Ready | Scheduled | Generating | Failed
-- Format values:   PDF | Excel | CSV
-- Category values: operational | compliance | assets | staff
-- ============================================================

-- ── Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eng_reports (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('operational','compliance','assets','staff')),
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

CREATE INDEX IF NOT EXISTS idx_eng_reports_category ON public.eng_reports(category);
CREATE INDEX IF NOT EXISTS idx_eng_reports_status ON public.eng_reports(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.eng_reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eng_reports_updated_at ON public.eng_reports;
CREATE TRIGGER trg_eng_reports_updated_at
  BEFORE UPDATE ON public.eng_reports
  FOR EACH ROW EXECUTE FUNCTION public.eng_reports_set_updated_at();

ALTER TABLE public.eng_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can CRUD eng_reports"
  ON public.eng_reports FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eng_reports TO authenticated;

-- ── Seed data (engineering-specific report definitions) ────────────────
INSERT INTO public.eng_reports (id, category, name, description, last_run, status, format, frequency)
SELECT * FROM (VALUES
  -- Operational Reports (6)
  ('eng-work-order-summary'::text,    'operational'::text, 'Work Order Summary'::text,           'All work orders by status, priority, and type for the period.'::text,            '2026-08-25 06:00'::timestamptz, 'Ready'::text,      'Excel'::text, 'Daily 06:00'::text),
  ('eng-pm-compliance',                 'operational',       'PM Compliance Report',               'Preventive maintenance schedule adherence and overdue PMs.',                     '2026-08-25 07:00',              'Ready',             'Excel',       'Daily 07:00'),
  ('eng-corrective-summary',            'operational',       'Corrective Maintenance Summary',     'Corrective tasks by category, priority, and resolution time.',                   '2026-08-25 08:00',              'Ready',             'PDF',         'Daily 08:00'),
  ('eng-room-maintenance',              'operational',       'Room Maintenance Report',            'Maintenance issues logged per room with status and resolution.',                 '2026-08-25 09:00',              'Ready',             'Excel',       'Daily 09:00'),
  ('eng-building-maintenance',          'operational',       'Building Maintenance Report',        'Building area tasks by status, area, and cost.',                                 '2026-08-25 08:30',              'Ready',             'PDF',         'Daily 08:30'),
  ('eng-utilities-consumption',         'operational',       'Utilities Consumption',              'Electricity, water, gas, and diesel consumption with cost breakdown.',           '2026-08-20 08:00',              'Ready',             'Excel',       'Monday 08:00'),
  -- Compliance Reports (5)
  ('eng-safety-compliance',             'compliance',        'Safety Compliance Report',           'Regulatory certificates, audits, and inspections with expiry tracking.',         '2026-08-25 07:00',              'Ready',             'PDF',         'Daily 07:00'),
  ('eng-calibration-report',            'compliance',        'Calibration Report',                 'Instrument calibrations by status, type, and tolerance deviation.',              '2026-08-25 08:00',              'Ready',             'Excel',       'Daily 08:00'),
  ('eng-inspection-report',             'compliance',        'Inspection Report',                  'All engineering inspections with scores and pass/fail outcomes.',                '2026-08-25 09:00',              'Ready',             'Excel',       'Daily 09:00'),
  ('eng-regulatory-certificates',       'compliance',        'Regulatory Certificate Tracker',     'All compliance items with expiry dates and overdue alerts.',                     '2026-08-25 10:00',              'Ready',             'PDF',         'Daily 10:00'),
  ('eng-audit-readiness',               'compliance',        'Audit Readiness Report',             'General health score and upcoming audit readiness assessment.',                  '2026-08-20 09:00',              'Scheduled',         'PDF',         'Monday 09:00'),
  -- Asset & Equipment Reports (5)
  ('eng-asset-lifecycle',               'assets',            'Asset Lifecycle Report',             'Asset depreciation, net book value, and disposal status.',                       '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('eng-equipment-downtime',            'assets',            'Equipment Downtime Report',          'Downtime hours by equipment, cause, and impact on operations.',                  '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('eng-spare-parts-usage',             'assets',            'Spare Parts Usage',                  'Spare parts consumed by work order, category, and cost.',                        '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('eng-equipment-efficiency',          'assets',            'Equipment Efficiency Report',        'Equipment efficiency metrics with status and target comparison.',                '2026-08-01 08:00',              'Scheduled',         'PDF',         '1st of month'),
  -- Staff Reports (4)
  ('eng-technician-performance',        'staff',             'Technician Performance',             'Jobs completed, response time, and workload per technician.',                    '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('eng-shift-report',                  'staff',             'Shift Report',                       'Per-shift summary of work orders, tasks, and escalations.',                      '2026-08-25 14:00',              'Ready',             'PDF',         'Daily 14:00'),
  ('eng-overtime-report',               'staff',             'Overtime Report',                    'Overtime hours logged by engineering staff.',                                    '2026-08-20 09:00',              'Scheduled',         'Excel',       'Monday 09:00'),
  ('eng-training-records',              'staff',             'Training Records',                   'Training certifications and expiry tracking for engineering staff.',             '2026-08-01 08:00',              'Ready',             'PDF',         '1st of month')
) AS t(id, category, name, description, last_run, status, format, frequency)
WHERE NOT EXISTS (SELECT 1 FROM public.eng_reports WHERE id = t.id);
