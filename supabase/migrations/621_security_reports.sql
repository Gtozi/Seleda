-- ============================================================================
-- 621_security_reports.sql — Security Reports Registry
-- Backs the /erp/security/reports screen. Mimics the HK reports pattern
-- (hk_reports / migration 316 / HKReportsModule.tsx): each row is a report
-- definition with last-run timestamp, status, output format, and frequency.
-- Run / Run All / Schedule actions persist back to this table.
--
-- Status values:   Ready | Scheduled | Generating | Failed
-- Format values:   PDF | Excel | CSV
-- Category values: operational | staff | compliance | executive
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sec_reports (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('operational','staff','compliance','executive')),
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

CREATE INDEX IF NOT EXISTS idx_sec_reports_category ON public.sec_reports(category);
CREATE INDEX IF NOT EXISTS idx_sec_reports_status   ON public.sec_reports(status);
CREATE INDEX IF NOT EXISTS idx_sec_reports_property ON public.sec_reports(property_id);

CREATE OR REPLACE FUNCTION sec_reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sec_reports_updated_at ON public.sec_reports;
CREATE TRIGGER trg_sec_reports_updated_at
  BEFORE UPDATE ON public.sec_reports
  FOR EACH ROW EXECUTE FUNCTION sec_reports_set_updated_at();

ALTER TABLE public.sec_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_reports TO authenticated;

-- ── Seed data ──────────────────────────────────────────────────────────
INSERT INTO public.sec_reports (id, category, name, description, last_run, status, format, frequency, property_id)
SELECT * FROM (VALUES
  -- Operational Reports (6)
  ('sec-daily-security-log'::text,    'operational'::text, 'Daily Security Log'::text,          'Shift-by-shift activity log: patrols, incidents, alarms, and notable events.'::text, NOW() - INTERVAL '2 hours'::interval,  'Ready'::text,     'PDF'::text,   'Daily 06:00'::text, '18762279-a389-41c9-9169-7ebc682e9703'::uuid),
  ('sec-incident-summary',            'operational',       'Incident Summary',                   'All incidents by type, priority, status, and response time.',                           NOW() - INTERVAL '3 hours',         'Ready',          'Excel',      'Daily 07:00',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-patrol-activity',             'operational',       'Patrol Activity Report',             'Completed vs scheduled patrols, checkpoint coverage, missed checkpoints.',              NOW() - INTERVAL '5 hours',         'Ready',          'Excel',      'Daily 07:30',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-visitor-access-log',          'operational',       'Visitor & Access Log',               'Visitor check-ins/outs, contractor passes, and denied-entry attempts.',                 NOW() - INTERVAL '4 hours',         'Ready',          'Excel',      'Daily 08:00',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-alarm-cctv-review',           'operational',       'Alarm & CCTV Review',                'Alarm triggers, camera downtime, and footage review requests.',                        NOW() - INTERVAL '6 hours',         'Ready',          'PDF',        'Daily 08:30',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-key-keycard-audit',           'operational',       'Key & Keycard Audit',                'Key issuance, keycard activations/deactivations, and unreturned keys.',                  NOW() - INTERVAL '26 hours',        'Ready',          'Excel',      'Daily 09:00',       '18762279-a389-41c9-9169-7ebc682e9703'),
  -- Staff Reports (4)
  ('sec-staff-performance',           'staff',             'Officer Performance',                'Patrols completed, incidents responded, reports filed, and scores per officer.',        NOW() - INTERVAL '7 days',          'Ready',          'Excel',      '1st of month',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-attendance-summary',          'staff',             'Attendance Summary',                 'Present/late/absent rates, hours worked, and overtime per staff member.',               NOW() - INTERVAL '1 day',           'Ready',          'Excel',      'Daily 09:30',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-training-certification',      'staff',             'Training & Certification',           'Certification status, upcoming expiries, and overdue renewals.',                        NOW() - INTERVAL '7 days',          'Scheduled',      'PDF',        'Monday 08:00',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-shift-coverage',              'staff',             'Shift Coverage Report',              'Required vs assigned staffing per shift and post, with gap analysis.',                  NOW() - INTERVAL '1 day',           'Ready',          'Excel',      'Daily 10:00',       '18762279-a389-41c9-9169-7ebc682e9703'),
  -- Compliance Reports (4)
  ('sec-compliance-status',           'compliance',        'Compliance Status Report',           'License, permit, and certification status with expiry tracking.',                      NOW() - INTERVAL '2 days',          'Ready',          'PDF',        '1st of month',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-safety-inspection',           'compliance',        'Safety Inspection Report',           'Safety inspections, hazard register, and corrective-action status.',                   NOW() - INTERVAL '2 days',          'Ready',          'Excel',      'Monday 10:00',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-risk-register',               'compliance',        'Risk Register Report',               'Enterprise risk register with likelihood/impact scoring and mitigation status.',         NOW() - INTERVAL '7 days',          'Scheduled',      'PDF',        '1st of month',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-fire-life-safety',            'compliance',        'Fire & Life Safety Report',          'Fire equipment status, inspection results, and drill outcomes.',                        NOW() - INTERVAL '2 days',          'Ready',          'PDF',        'Monday 11:00',      '18762279-a389-41c9-9169-7ebc682e9703'),
  -- Executive Reports (4)
  ('sec-executive-summary',           'executive',         'Executive Security Summary',         'High-level security posture: incidents, risks, compliance, and staffing KPIs.',         NOW() - INTERVAL '1 day',           'Ready',          'PDF',        'Daily 07:00',       '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-incident-trends',             'executive',         'Incident Trend Analysis',            'Incident volume and severity trends over time, by category and location.',              NOW() - INTERVAL '7 days',          'Ready',          'Excel',      '1st of month',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-loss-prevention',             'executive',         'Loss Prevention Report',             'Fraud cases, asset losses, and shrinkage exposure with financial impact.',              NOW() - INTERVAL '7 days',          'Scheduled',      'Excel',      '1st of month',      '18762279-a389-41c9-9169-7ebc682e9703'),
  ('sec-emergency-preparedness',      'executive',         'Emergency Preparedness',             'BCP plan status, exercise results, and crisis-readiness assessment.',                   NULL,                             'Scheduled',      'PDF',        '1st of quarter',    '18762279-a389-41c9-9169-7ebc682e9703')
) AS t(id, category, name, description, last_run, status, format, frequency, property_id)
WHERE NOT EXISTS (SELECT 1 FROM public.sec_reports WHERE id = t.id);
