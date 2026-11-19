-- ============================================================
-- 649_exec_gap_fixes.sql
-- Executive portal gap fixes:
--  1. Director-tier read-only access to the Executive BI portal
--     (role_director granted exec:view and linked to director /
--     managing-director system_users). The route middleware also
--     accepts these roles directly; this grant makes the RBAC
--     catalog reflect the intended access.
--  2. New exec:approvals:decide permission for the executive
--     approval-decision endpoint (approve/reject/escalate).
--  3. Hourly exec_alert_eval scheduled job so alert rules notify
--     within ~1h instead of only at the 06:05 daily snapshot.
--  4. dashboard_views seed fix: several tile_layout keys referenced
--     KPI ids the /api/executive/dashboard endpoint never emits
--     (ar_aging, ap_aging, room_turnaround_time, ...). Re-mapped to
--     real KPI ids so Owner/DeptManager/Finance/Auditor/GM views
--     actually reorder tiles.
--  5. RLS tightening on exec_strategic_items + exec_item_overrides:
--     the original policies granted full CRUD to every authenticated
--     principal. All writes go through the service-role backend, so
--     direct Data-API access is reduced to read-only.
-- ============================================================

-- ── 1. Director read-only exec access ───────────────────────────────────
INSERT INTO roles (id, name, description, is_superuser, is_system)
VALUES ('role_director', 'director',
        'Director — read-only access to the Executive BI portal', false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'role_director', p.id
FROM permissions p
WHERE p.code = 'exec:view'
ON CONFLICT DO NOTHING;

-- Link existing director-tier users (defensive; the route middleware
-- accepts these roles even without a user_roles row).
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, 'role_director'
FROM system_users u
WHERE lower(u.role) IN ('director', 'managing_director', 'managing director', 'exec')
ON CONFLICT DO NOTHING;

-- ── 2. Executive approval-decision permission ───────────────────────────
INSERT INTO permissions (id, code, module, description) VALUES
  ('perm_exec_approvals_decide', 'exec:approvals:decide', 'executive',
   'Approve / reject / escalate items from the executive approvals queue')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.id IN ('role_executive', 'role_admin')
  AND p.code = 'exec:approvals:decide'
ON CONFLICT DO NOTHING;

-- ── 3. Hourly alert evaluation job ──────────────────────────────────────
-- Handler registered in src/server/scheduler.ts as `exec_alert_eval`.
INSERT INTO scheduled_jobs (name, type, schedule_cron, config, enabled)
VALUES (
  'Executive Alert Evaluation',
  'exec_alert_eval',
  '23 * * * *',
  '{}'::jsonb,
  true
)
ON CONFLICT DO NOTHING;

-- ── 4. dashboard_views seed fixes ───────────────────────────────────────
-- Valid KPI ids emitted by GET /api/executive/dashboard:
--   total_revenue room_revenue operating_expenses gop goppar
--   operating_margin cash_position occupancy adr revpar trevpar alos
--   new_bookings cancellation_rate ooo_rooms satisfaction complaint_rate
--   request_resolution repeat_guests loyalty_members total_guests
--   fb_revenue fb_orders avg_check food_cost bev_cost ticket_time
--   headcount labor_cost_pct attendance turnover overtime rev_per_employee
--   wo_completion open_wos pm_compliance asset_availability electricity
--   hk_completion po_spend open_pos suppliers stock_value low_stock
--   incidents open_incidents inc_resolution banquet_revenue
--   upcoming_events spa_revenue spa_appointments trips_completed

UPDATE dashboard_views SET tile_layout =
  '{"total_revenue":{"row":0,"col":0,"size":"Medium"},"goppar":{"row":0,"col":1,"size":"Medium"},"occupancy":{"row":1,"col":0,"size":"Small"},"adr":{"row":1,"col":1,"size":"Small"},"revpar":{"row":1,"col":2,"size":"Small"},"cash_position":{"row":2,"col":0,"size":"Small"},"operating_margin":{"row":2,"col":1,"size":"Small"},"turnover":{"row":2,"col":2,"size":"Small"}}'::jsonb
WHERE name = 'Owner Executive Summary';

UPDATE dashboard_views SET tile_layout =
  '{"occupancy":{"row":0,"col":0,"size":"Small"},"adr":{"row":0,"col":1,"size":"Small"},"open_wos":{"row":0,"col":2,"size":"Small"},"new_bookings":{"row":1,"col":0,"size":"Small"},"food_cost":{"row":1,"col":1,"size":"Small"},"labor_cost_pct":{"row":1,"col":2,"size":"Small"},"hk_completion":{"row":2,"col":0,"size":"Small"},"wo_completion":{"row":2,"col":1,"size":"Small"},"ooo_rooms":{"row":2,"col":2,"size":"Small"}}'::jsonb
WHERE name = 'Department Manager Operations';

UPDATE dashboard_views SET tile_layout =
  '{"total_revenue":{"row":0,"col":0,"size":"Medium"},"goppar":{"row":0,"col":1,"size":"Medium"},"labor_cost_pct":{"row":1,"col":0,"size":"Small"},"cash_position":{"row":1,"col":1,"size":"Small"},"operating_expenses":{"row":1,"col":2,"size":"Small"},"operating_margin":{"row":2,"col":0,"size":"Small"},"po_spend":{"row":2,"col":1,"size":"Small"},"gop":{"row":2,"col":2,"size":"Small"}}'::jsonb
WHERE name = 'Finance Departmental';

UPDATE dashboard_views SET tile_layout =
  '{"labor_cost_pct":{"row":0,"col":0,"size":"Small"},"food_cost":{"row":0,"col":1,"size":"Small"},"open_wos":{"row":0,"col":2,"size":"Small"},"low_stock":{"row":1,"col":0,"size":"Small"},"open_incidents":{"row":1,"col":1,"size":"Small"},"inc_resolution":{"row":1,"col":2,"size":"Small"},"pm_compliance":{"row":2,"col":0,"size":"Small"},"complaint_rate":{"row":2,"col":1,"size":"Small"},"incidents":{"row":2,"col":2,"size":"Small"}}'::jsonb
WHERE name = 'Auditor Compliance View';

UPDATE dashboard_views SET tile_layout =
  '{"occupancy":{"row":0,"col":0,"size":"Small"},"adr":{"row":0,"col":1,"size":"Small"},"revpar":{"row":0,"col":2,"size":"Small"},"total_revenue":{"row":0,"col":3,"size":"Small"},"labor_cost_pct":{"row":1,"col":0,"size":"Small"},"open_wos":{"row":1,"col":1,"size":"Small"},"new_bookings":{"row":1,"col":2,"size":"Small"},"food_cost":{"row":1,"col":3,"size":"Small"},"headcount":{"row":2,"col":0,"size":"Small"},"cash_position":{"row":2,"col":1,"size":"Small"}}'::jsonb
WHERE name = 'GM Daily Dashboard';

-- ── 5. RLS tightening on exec-owned tables ──────────────────────────────
-- All writes flow through the service-role backend (which bypasses RLS);
-- authenticated Data-API clients only need read access.
DROP POLICY IF EXISTS "authenticated can CRUD exec_strategic_items" ON public.exec_strategic_items;
CREATE POLICY "authenticated read exec_strategic_items" ON public.exec_strategic_items
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.exec_strategic_items FROM authenticated;

DROP POLICY IF EXISTS "authenticated can CRUD exec_item_overrides" ON public.exec_item_overrides;
CREATE POLICY "authenticated read exec_item_overrides" ON public.exec_item_overrides
  FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.exec_item_overrides FROM authenticated;
