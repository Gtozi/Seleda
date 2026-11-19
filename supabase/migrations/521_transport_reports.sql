-- 521_transport_reports.sql
-- Transportation report registry — mirrors hk_reports (migration 316).

CREATE TABLE IF NOT EXISTS transport_reports (
  id            TEXT PRIMARY KEY,
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  category      TEXT NOT NULL
                  CHECK (category IN ('Operational', 'Fleet', 'Financial', 'Performance')),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  last_run      TIMESTAMPTZ,
  generated_by  TEXT NOT NULL DEFAULT 'System',
  status        TEXT NOT NULL DEFAULT 'Ready'
                  CHECK (status IN ('Ready', 'Scheduled', 'Generating', 'Failed')),
  format        TEXT NOT NULL DEFAULT 'PDF'
                  CHECK (format IN ('PDF', 'Excel', 'CSV')),
  frequency     TEXT NOT NULL DEFAULT 'Daily',
  size          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_reports_property ON transport_reports(property_id);
CREATE INDEX IF NOT EXISTS idx_transport_reports_category ON transport_reports(property_id, category);

DROP TRIGGER IF EXISTS transport_reports_updated_at ON transport_reports;
CREATE TRIGGER transport_reports_updated_at
  BEFORE UPDATE ON transport_reports
  FOR EACH ROW EXECUTE FUNCTION hr_recruit_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON transport_reports TO authenticated;

ALTER TABLE transport_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_reports_read ON transport_reports;
CREATE POLICY transport_reports_read ON transport_reports
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS transport_reports_write ON transport_reports;
CREATE POLICY transport_reports_write ON transport_reports
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = auth.uid()::text AND r.name = 'admin'));

-- ── Seed: the mock's report catalog for GH-MAIN ─────────────────────────────
INSERT INTO transport_reports (id, property_id, category, name, description, last_run, generated_by, status, format, frequency, size)
SELECT * FROM (VALUES
  ('RPT-001', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Operational', 'Daily Trip Report',
   'Summary of all trips completed today', NOW() - interval '2 hours', 'System', 'Ready', 'PDF', 'Daily', '245 KB'),
  ('RPT-002', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Fleet', 'Vehicle Utilization Report',
   'Fleet utilization and availability metrics', NOW() - interval '10 hours', 'System', 'Ready', 'Excel', 'Daily', '180 KB'),
  ('RPT-003', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Performance', 'Driver Performance Report',
   'Driver performance metrics and ratings', NOW() - interval '16 hours', 'System', 'Ready', 'PDF', 'Daily', '320 KB'),
  ('RPT-004', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Operational', 'Airport Transfer Report',
   'Airport pickup and drop-off statistics', NOW() - interval '4 hours', 'System', 'Ready', 'PDF', 'Daily', '195 KB'),
  ('RPT-005', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Financial', 'Transportation Revenue Report',
   'Revenue and cost analysis', NOW() - interval '8 hours', 'System', 'Scheduled', 'Excel', 'Weekly', '410 KB'),
  ('RPT-006', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Fleet', 'Fuel Consumption Report',
   'Fuel usage and cost analysis', NOW() - interval '9 hours', 'System', 'Ready', 'Excel', 'Weekly', '155 KB'),
  ('RPT-007', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Operational', 'Shuttle Performance Report',
   'Shuttle service performance metrics', NOW() - interval '6 hours', 'System', 'Ready', 'PDF', 'Daily', '210 KB'),
  ('RPT-008', '18762279-a389-41c9-9169-7ebc682e9703'::uuid, 'Fleet', 'Monthly Fleet Summary',
   'Comprehensive monthly fleet overview', date_trunc('month', NOW()), 'Admin', 'Scheduled', 'PDF', 'Monthly', '1.2 MB')
) AS s(id, property_id, category, name, description, last_run, generated_by, status, format, frequency, size)
WHERE NOT EXISTS (SELECT 1 FROM transport_reports WHERE property_id = '18762279-a389-41c9-9169-7ebc682e9703');
