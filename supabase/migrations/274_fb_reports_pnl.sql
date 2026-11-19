-- Migration: Add P&L by Outlet & Total report to fb_reports
--
-- Adds a new 'pnl' function category to fb_reports and inserts the
-- RPT-PNL report. The P&L is computed on the fly by /api/fb/analytics/pnl
-- from fb_outlet_analytics (revenue) + fb_cost_analytics (COGS, waste) +
-- fb_staff_productivity (labor hours → labor cost at a configurable rate),
-- joined by outlet for the selected period, with a consolidated TOTAL row.

-- ── 1. Extend the category CHECK to accept the new 'pnl' function key ──
ALTER TABLE fb_reports DROP CONSTRAINT IF EXISTS fb_reports_category_check;
ALTER TABLE fb_reports ADD CONSTRAINT fb_reports_category_check
  CHECK (category IN ('outlet','menu','cost','discount','labor','waste','procurement','banquet','pnl'));

-- ── 2. Insert the P&L functional report ─────────────────────────────────
INSERT INTO fb_reports (id, category, name, description, last_run, status, format, frequency)
SELECT * FROM (VALUES
  ('RPT-PNL'::text,'pnl'::text,'P&L by Outlet & Total'::text,
   'Profit & Loss statement by outlet with consolidated total — revenue, COGS, gross profit, waste, labor cost, and net profit'::text,
   '2026-08-19 10:00'::timestamptz,'Ready'::text,'PDF'::text,'Monthly'::text)
) AS t(id,category,name,description,last_run,status,format,frequency)
WHERE NOT EXISTS (SELECT 1 FROM fb_reports WHERE id = t.id);

-- ── 3. Update the permission description ────────────────────────────────
UPDATE permissions
SET description = 'View and run F&B reports (outlet, menu, cost, discount, labor, waste, procurement, banquet, pnl)'
WHERE code = 'fb:reports:view';
