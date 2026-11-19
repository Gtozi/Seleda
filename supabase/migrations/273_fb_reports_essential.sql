-- Migration: Add essential F&B reports backed by real transactional tables
--
-- Adds 3 new function-based reports to fb_reports, backed by tables that
-- already exist and already hold real transactional data (not analytics
-- snapshots): wastage_logs, fb_purchase_orders/fb_suppliers, and
-- banquet_events. Also seeds a few banquet_events demo rows since that
-- table was empty, so the new report has something to show.
--
-- New function keys: waste | procurement | banquet
-- (labor already existed — its preview source moves to fb_staff_productivity
-- in application code, no schema change needed for that one)

-- ── 1. Extend the category CHECK to accept the 3 new function keys ───
ALTER TABLE fb_reports DROP CONSTRAINT IF EXISTS fb_reports_category_check;
ALTER TABLE fb_reports ADD CONSTRAINT fb_reports_category_check
  CHECK (category IN ('outlet','menu','cost','discount','labor','waste','procurement','banquet'));

-- ── 2. Insert the 3 new functional reports ────────────────────────────
INSERT INTO fb_reports (id, category, name, description, last_run, status, format, frequency)
SELECT * FROM (VALUES
  ('RPT-WASTE'::text,'waste'::text,'Waste & Spoilage'::text,
   'Preparation, spoilage, breakage, and theft log by ingredient and location'::text,
   '2026-08-18 17:30'::timestamptz,'Ready'::text,'Excel'::text,'Daily 06:00'::text),
  ('RPT-PROCUREMENT','procurement','Procurement & Suppliers',
   'Purchase order spend, status, and supplier activity',
   '2026-08-19 08:00','Ready','Excel','Daily 08:00'),
  ('RPT-BANQUET','banquet','Banquet & Events',
   'Banquet event pipeline, guest counts, and revenue by status',
   '2026-08-19 09:00','Ready','PDF','Weekly')
) AS t(id,category,name,description,last_run,status,format,frequency)
WHERE NOT EXISTS (SELECT 1 FROM fb_reports WHERE id = t.id);

-- ── 3. Seed a few banquet_events demo rows (table was empty) ──────────
INSERT INTO banquet_events (id, event_name, event_date, client_name, guest_count, menu_package, room_setup, status, estimated_revenue, actual_revenue)
SELECT * FROM (VALUES
  ('BEO-DEMO-001'::text,'Hamlin Corp Annual Gala'::text,'2026-08-19'::date,'Hamlin Corporation'::text,180,'Premium Plated'::text,'Banquet Hall A — Theatre'::text,'Confirmed'::text,450000::numeric,0::numeric),
  ('BEO-DEMO-002','Tesfaye-Bekele Wedding','2026-08-05','Tesfaye & Bekele Families',260,'Buffet Deluxe','Grand Ballroom — Round Tables','Completed',620000,645000),
  ('BEO-DEMO-003','Q3 Sales Kickoff','2026-08-22','Selam Trading PLC',90,'Coffee Break + Lunch','Conference Room 2 — Classroom','Draft',95000,0)
) AS t(id,event_name,event_date,client_name,guest_count,menu_package,room_setup,status,estimated_revenue,actual_revenue)
WHERE NOT EXISTS (SELECT 1 FROM banquet_events WHERE id = t.id);

-- ── 4. Update the permission description ─────────────────────────────
UPDATE permissions
SET description = 'View and run F&B reports (outlet, menu, cost, discount, labor, waste, procurement, banquet)'
WHERE code = 'fb:reports:view';
