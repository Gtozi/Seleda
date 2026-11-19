-- Migration: Housekeeping Reports Registry
-- Backs the /erp/housekeeping/reports screen. Replaces the hardcoded mock
-- report list in HKReportsModule.tsx with a real DB-backed registry, mimicking
-- the F&B reports pattern (fb_reports / fbReports.routes.ts / FBReports.tsx).
--
-- Each row is a report definition with its last-run timestamp, status, output
-- format, and generation frequency. Run / Run All / Schedule actions persist
-- back to this table.
--
-- Status values:  Ready | Scheduled | Generating | Failed
-- Format values:  PDF | Excel | CSV
-- Category values: operational | staff | inventory | quality

-- ── Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hk_reports (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('operational','staff','inventory','quality')),
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

CREATE INDEX IF NOT EXISTS idx_hk_reports_category ON hk_reports(category);
CREATE INDEX IF NOT EXISTS idx_hk_reports_status ON hk_reports(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION hk_reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hk_reports_updated_at ON hk_reports;
CREATE TRIGGER trg_hk_reports_updated_at
  BEFORE UPDATE ON hk_reports
  FOR EACH ROW EXECUTE FUNCTION hk_reports_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON hk_reports TO authenticated;

-- ── Seed data (mirrors the prior hardcoded REPORTS list) ───────────────
INSERT INTO hk_reports (id, category, name, description, last_run, status, format, frequency)
SELECT * FROM (VALUES
  -- Operational Reports (6)
  ('hk-house-status'::text,           'operational'::text, 'House Status Report'::text,        'Snapshot of all room conditions across the property.'::text,             '2026-08-23 06:00'::timestamptz, 'Ready'::text,      'Excel'::text, 'Daily 06:00'::text),
  ('hk-room-cleaning',                  'operational',       'Room Cleaning Report',              'Cleaning jobs completed, in progress, and pending.',                     '2026-08-23 07:00',              'Ready',             'Excel',       'Daily 07:00'),
  ('hk-room-readiness',                 'operational',       'Room Readiness Report',             'Rooms ready for arrival vs. pending preparation.',                        '2026-08-23 08:00',              'Ready',             'PDF',         'Daily 08:00'),
  ('hk-occupancy-vs-cleaning',          'operational',       'Occupancy vs Cleaning',             'Correlation of occupancy levels with cleaning throughput.',              '2026-08-23 09:00',              'Ready',             'Excel',       'Daily 09:00'),
  ('hk-vip-room-status',                'operational',       'VIP Room Status',                   'Status of VIP arrival rooms and preparation priority.',                   '2026-08-23 08:30',              'Ready',             'PDF',         'Daily 08:30'),
  ('hk-cleaning-productivity',          'operational',       'Cleaning Productivity',             'Rooms completed per attendant and average cleaning time.',               '2026-08-18 08:00',              'Ready',             'Excel',       'Monday 08:00'),
  -- Staff Reports (4)
  ('hk-attendant-performance',          'staff',             'Attendant Performance',             'Productivity and inspection scores per room attendant.',                  '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('hk-supervisor-performance',         'staff',             'Supervisor Performance',            'Inspection approvals, escalations handled, shift coverage.',              '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('hk-shift-report',                   'staff',             'Shift Report',                      'Per-shift summary of rooms cleaned, inspected, and escalated.',           '2026-08-23 14:00',              'Ready',             'PDF',         'Daily 14:00'),
  ('hk-overtime-report',                'staff',             'Overtime Report',                   'Overtime hours logged by housekeeping staff.',                            '2026-08-18 09:00',              'Scheduled',         'Excel',       'Monday 09:00'),
  -- Inventory Reports (5)
  ('hk-amenity-consumption',            'inventory',         'Amenity Consumption',               'Guest amenity consumption and replenishment trends.',                     '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('hk-linen-usage',                    'inventory',         'Linen Usage',                       'Linen issued, returned, and in circulation by type.',                     '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  ('hk-damaged-linen',                  'inventory',         'Damaged Linen',                     'Linen written off due to damage, by type and cause.',                     '2026-08-01 08:00',              'Ready',             'PDF',         '1st of month'),
  ('hk-lost-linen',                     'inventory',         'Lost Linen',                        'Linen losses recorded during the period.',                                '2026-08-01 08:00',              'Scheduled',         'PDF',         '1st of month'),
  ('hk-chemical-consumption',           'inventory',         'Chemical Consumption',              'Cleaning chemical usage and cost per area.',                              '2026-08-01 08:00',              'Ready',             'Excel',       '1st of month'),
  -- Quality Reports (4)
  ('hk-inspection-report',              'quality',           'Inspection Report',                 'All room inspections with scores and pass/fail outcomes.',                '2026-08-18 10:00',              'Ready',             'Excel',       'Monday 10:00'),
  ('hk-failed-inspection',              'quality',           'Failed Inspection Report',          'Inspections that failed, with rework status tracking.',                   '2026-08-23 11:00',              'Ready',             'PDF',         'Daily 11:00'),
  ('hk-guest-complaint',                'quality',           'Guest Complaint Report',            'Housekeeping-related guest complaints and resolution time.',              '2026-08-01 08:00',              'Scheduled',         'Excel',       '1st of month'),
  ('hk-rework-report',                  'quality',           'Rework Report',                     'Rooms requiring rework after failed inspections.',                        '2026-08-18 11:00',              'Ready',             'PDF',         'Monday 11:00')
) AS t(id, category, name, description, last_run, status, format, frequency)
WHERE NOT EXISTS (SELECT 1 FROM hk_reports WHERE id = t.id);
