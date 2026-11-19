-- Migration: Consolidate F&B reports by function
-- Replaces the 23 cadence-based reports (daily/weekly/monthly/executive) with
-- 5 function-based reports. The period toggle (Today/WTD/MTD/YTD/Custom) now
-- controls the time scope for every report, so separate daily/weekly/monthly/
-- executive variants of the same underlying analysis are no longer needed.
--
-- Function keys:  outlet | menu | cost | discount | labor
-- Status values:  Ready | Scheduled | Generating | Failed
-- Format values:  PDF | Excel | CSV

-- ── 1. Delete old rows first (they have old category values) ─────────
DELETE FROM fb_reports;

-- ── 2. Loosen the category CHECK to accept function keys ─────────────
ALTER TABLE fb_reports DROP CONSTRAINT IF EXISTS fb_reports_category_check;
ALTER TABLE fb_reports ADD CONSTRAINT fb_reports_category_check
  CHECK (category IN ('outlet','menu','cost','discount','labor'));

-- ── 3. Insert the 5 functional reports ───────────────────────────────
INSERT INTO fb_reports (id, category, name, description, last_run, status, format, frequency)
VALUES
  ('RPT-OUTLET','outlet','Outlet Sales & Performance',
   'Revenue, covers, RevPASH, profitability, and ranking by outlet',
   '2026-08-12 06:00','Ready','Excel','Daily 06:00'),
  ('RPT-MENU','menu','Menu Engineering',
   'Item sales, popularity, contribution margin, and classification',
   '2026-08-10 07:00','Ready','Excel','Weekly'),
  ('RPT-COST','cost','Cost & Variance',
   'Food & beverage cost, waste, variance, and theoretical vs actual usage',
   '2026-08-12 06:00','Ready','Excel','Daily 06:00'),
  ('RPT-DISCOUNT','discount','Discounts & Promotions',
   'Discounts, voids, comps, and promotional/happy-hour usage',
   '2026-08-12 06:00','Ready','Excel','Daily 06:00'),
  ('RPT-LABOR','labor','Labor Productivity',
   'Covers per labor hour, revenue per hour, and station productivity',
   '2026-08-10 07:00','Ready','PDF','Weekly');

-- ── 4. Update the permission description ─────────────────────────────
UPDATE permissions
SET description = 'View and run F&B reports (outlet, menu, cost, discount, labor)'
WHERE code = 'fb:reports:view';
