-- Migration: Admin Reports registry
-- Backs the /erp/admin/reports screen. Mirrors fb_reports (migration 271):
-- each row is a report definition bound to a live admin dataset
-- (see DATASETS in src/server/routes/adminControl.routes.ts).
--
-- Status values:  Ready | Scheduled | Generating | Failed
-- Format values:  PDF | Excel | CSV
-- Category values: Administration | Master data | Operations | Finance | Compliance

CREATE TABLE IF NOT EXISTS admin_reports (
  id TEXT PRIMARY KEY,
  dataset TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  last_run TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Ready','Scheduled','Generating','Failed')),
  format TEXT NOT NULL DEFAULT 'CSV' CHECK (format IN ('PDF','Excel','CSV')),
  frequency TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_reports ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_reports_category ON admin_reports(category);
CREATE INDEX IF NOT EXISTS idx_admin_reports_status ON admin_reports(status);
CREATE INDEX IF NOT EXISTS idx_admin_reports_dataset ON admin_reports(dataset);

CREATE OR REPLACE FUNCTION admin_reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_reports_updated_at ON admin_reports;
CREATE TRIGGER trg_admin_reports_updated_at
  BEFORE UPDATE ON admin_reports
  FOR EACH ROW EXECUTE FUNCTION admin_reports_set_updated_at();

-- ── Seed: one report per live admin dataset ─────────────────────────
INSERT INTO admin_reports (id, dataset, category, name, description, status, format, frequency)
SELECT * FROM (VALUES
  ('AR-01','users','Administration','User Register','All ERP user accounts with roles and login status','Scheduled','Excel','On demand'),
  ('AR-02','roles','Administration','Roles & Permissions','Custom roles and their permission grants','Scheduled','PDF','On demand'),
  ('AR-03','audit','Administration','Audit Trail','Latest security and system audit events','Scheduled','CSV','On demand'),
  ('AR-04','properties','Master data','Property Register','All hotel properties in the organisation','Scheduled','Excel','On demand'),
  ('AR-05','rooms','Master data','Room Inventory','Rooms with status, type, and floor','Scheduled','Excel','On demand'),
  ('AR-06','room_types','Master data','Room Types','Room type catalogue and configuration','Scheduled','PDF','On demand'),
  ('AR-07','guests','Operations','Guest Profiles','Guest master records','Scheduled','Excel','On demand'),
  ('AR-08','reservations','Operations','Reservations','Booking reservations across properties','Scheduled','Excel','On demand'),
  ('AR-09','employees','Operations','Employees','Staff records and employment details','Scheduled','Excel','On demand'),
  ('AR-10','work_orders','Operations','Work Orders','Maintenance and service work orders','Scheduled','PDF','On demand'),
  ('AR-11','folios','Finance','Folio Accounts','Guest folio accounts and balances','Scheduled','Excel','On demand'),
  ('AR-12','licenses','Compliance','Licences','Software licences and validity','Scheduled','PDF','On demand'),
  ('AR-13','devices','Compliance','Device Inventory','Registered endpoint devices','Scheduled','CSV','On demand'),
  ('AR-14','backup_jobs','Compliance','Backup History','Backup job history and status','Scheduled','CSV','On demand')
) AS t(id,dataset,category,name,description,status,format,frequency)
WHERE NOT EXISTS (SELECT 1 FROM admin_reports WHERE id = t.id);
