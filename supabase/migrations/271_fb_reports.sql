-- Migration: F&B Reports
-- Backs the /erp/fb/reports screen. Replaces the hardcoded mock report list in
-- FBReports.tsx with a real DB-backed registry. Each row is a report definition
-- (Daily / Weekly / Monthly / Executive) with its last-run timestamp, status,
-- output format, and generation frequency.
--
-- Status values:  Ready | Scheduled | Generating | Failed
-- Format values:  PDF | Excel | CSV
-- Category values: daily | weekly | monthly | executive

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── fb_reports ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_reports (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('daily','weekly','monthly','executive')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  last_run TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Ready','Scheduled','Generating','Failed')),
  format TEXT NOT NULL DEFAULT 'Excel' CHECK (format IN ('PDF','Excel','CSV')),
  frequency TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  property_id UUID
);

ALTER TABLE fb_reports ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fb_reports_category ON fb_reports(category);
CREATE INDEX IF NOT EXISTS idx_fb_reports_status ON fb_reports(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION fb_reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fb_reports_updated_at ON fb_reports;
CREATE TRIGGER trg_fb_reports_updated_at
  BEFORE UPDATE ON fb_reports
  FOR EACH ROW EXECUTE FUNCTION fb_reports_set_updated_at();

-- ── Permission ──────────────────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
SELECT 'perm_fb_reports_view', 'fb:reports:view', 'fnb',
       'View and run F&B reports (daily, weekly, monthly, executive)'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'fb:reports:view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fb:reports:view'
WHERE r.name IN ('admin','super_admin','executive','general_manager','owner','fb_manager','finance_controller','cfo','operations_manager')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);

-- ── Seed data (mirrors the prior hardcoded mock list) ───────────────
-- last_run timestamps are anchored to 2026-08-12 to match the previous UI.
INSERT INTO fb_reports (id, category, name, description, last_run, status, format, frequency)
SELECT * FROM (VALUES
  -- Daily
  ('DR-01'::text,'daily'::text,'Daily Outlet Sales'::text,'Net sales by outlet and revenue center'::text,'2026-08-12 06:00'::timestamptz,'Ready'::text,'Excel'::text,'Daily 06:00'::text),
  ('DR-02','daily','Covers & Average Check','Covers, average check, and revenue per guest','2026-08-12 06:00','Ready','Excel','Daily 06:00'),
  ('DR-03','daily','Daily Food Cost','Theoretical and actual food cost summary','2026-08-12 06:00','Ready','PDF','Daily 06:00'),
  ('DR-04','daily','Daily Beverage Cost','Beverage cost and variance','2026-08-12 06:00','Ready','PDF','Daily 06:00'),
  ('DR-05','daily','Discounts & Voids','Discounts, voids, and complimentary summary','2026-08-12 06:00','Ready','Excel','Daily 06:00'),
  ('DR-06','daily','Comps & Promotions','Complimentary, promotional, and happy-hour usage','2026-08-12 06:00','Ready','CSV','Daily 06:00'),
  ('DR-07','daily','Waste Log','Preparation, spoilage, and plate waste log','2026-08-12 05:45','Scheduled','Excel','Daily 05:45'),
  -- Weekly
  ('WR-01','weekly','Outlet Performance','Revenue, covers, and RevPASH by outlet','2026-08-10 07:00','Ready','Excel','Monday 07:00'),
  ('WR-02','weekly','Menu Performance','Item sales, popularity, and contribution margin','2026-08-10 07:00','Ready','Excel','Monday 07:00'),
  ('WR-03','weekly','Labor Productivity','Covers per labor hour and revenue per hour','2026-08-10 07:00','Ready','PDF','Monday 07:00'),
  ('WR-04','weekly','Cost Variance','Food & beverage cost variance vs budget','2026-08-10 07:00','Ready','Excel','Monday 07:00'),
  -- Monthly
  ('MR-01','monthly','F&B P&L','F&B profit and loss statement','2026-08-01 08:00','Ready','PDF','1st of month'),
  ('MR-02','monthly','Outlet Profitability','Profitability by outlet with cost allocation','2026-08-01 08:00','Ready','Excel','1st of month'),
  ('MR-03','monthly','Menu Engineering','Menu engineering and pricing review','2026-08-01 08:00','Ready','Excel','1st of month'),
  ('MR-04','monthly','Food Cost Analysis','Detailed food cost, waste, and theoretical usage','2026-08-01 08:00','Ready','Excel','1st of month'),
  ('MR-05','monthly','Beverage Cost Analysis','Pour cost, variance, and inventory reconciliation','2026-08-01 08:00','Ready','Excel','1st of month'),
  ('MR-06','monthly','Waste Analysis','Waste by category, reason, and outlet','2026-08-01 08:00','Ready','Excel','1st of month'),
  -- Executive
  ('ER-01','executive','F&B Revenue','Consolidated F&B revenue and budget tracking','2026-08-10 09:00','Ready','PDF','Weekly'),
  ('ER-02','executive','Profitability','Gross profit, contribution margin, and outlet ranking','2026-08-10 09:00','Ready','PDF','Weekly'),
  ('ER-03','executive','RevPASH','Revenue per available seat hour','2026-08-10 09:00','Ready','Excel','Weekly'),
  ('ER-04','executive','Outlet Ranking','Ranking by revenue, covers, and profit','2026-08-10 09:00','Ready','Excel','Weekly'),
  ('ER-05','executive','Menu Performance','Top and bottom performing items','2026-08-10 09:00','Ready','PDF','Weekly'),
  ('ER-06','executive','Cost Trends','Food, beverage, and labor cost trends','2026-08-10 09:00','Failed','Excel','Weekly')
) AS t(id,category,name,description,last_run,status,format,frequency)
WHERE NOT EXISTS (SELECT 1 FROM fb_reports WHERE id = t.id);
