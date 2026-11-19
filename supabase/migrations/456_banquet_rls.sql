-- =============================================================================
-- Migration 456: Banquet & Events — Row Level Security
-- =============================================================================
-- PROBLEM
--   Almost every banquet_* table had no RLS enabled, so any holder of the
--   anon key could read/write all properties' operational data via PostgREST.
--   Worse, banquet_staff_* and banquet_event_config had RLS enabled but no
--   policies at all, locking out every non-service-role session.
--
-- SOLUTION
--   Follow the convention used by event_bookings (444) and event_charges
--   (445): enable RLS, grant full CRUD to authenticated, and allow the
--   service role to bypass (it does anyway — no explicit policy needed).
--   Property scoping is enforced at the API layer; these policies are
--   defense-in-depth for direct client access.
--
-- Depends on: all banquet_* tables from migrations 101–455
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: enable RLS + authenticated CRUD policy + grants for one table.
-- ─────────────────────────────────────────────────────────────────────────────

-- Core operational tables (migrations 101–112)
ALTER TABLE public.banquet_venues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_venues_authenticated ON public.banquet_venues;
CREATE POLICY banquet_venues_authenticated ON public.banquet_venues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_venues TO authenticated;

ALTER TABLE public.banquet_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_schedules_authenticated ON public.banquet_schedules;
CREATE POLICY banquet_schedules_authenticated ON public.banquet_schedules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_schedules TO authenticated;

ALTER TABLE public.banquet_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_checklists_authenticated ON public.banquet_checklists;
CREATE POLICY banquet_checklists_authenticated ON public.banquet_checklists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_checklists TO authenticated;

ALTER TABLE public.banquet_beos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_beos_authenticated ON public.banquet_beos;
CREATE POLICY banquet_beos_authenticated ON public.banquet_beos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_beos TO authenticated;

-- Event-type details & per-type checklists (migration 105)
ALTER TABLE public.banquet_event_type_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_type_items_authenticated ON public.banquet_event_type_items;
CREATE POLICY banquet_event_type_items_authenticated ON public.banquet_event_type_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_type_items TO authenticated;

ALTER TABLE public.banquet_event_type_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_type_checklists_authenticated ON public.banquet_event_type_checklists;
CREATE POLICY banquet_event_type_checklists_authenticated ON public.banquet_event_type_checklists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_type_checklists TO authenticated;

-- Catering (migrations 107–110)
ALTER TABLE public.banquet_menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_menu_items_authenticated ON public.banquet_menu_items;
CREATE POLICY banquet_menu_items_authenticated ON public.banquet_menu_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_menu_items TO authenticated;

ALTER TABLE public.banquet_beverages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_beverages_authenticated ON public.banquet_beverages;
CREATE POLICY banquet_beverages_authenticated ON public.banquet_beverages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_beverages TO authenticated;

-- Logistics (migration 112)
ALTER TABLE public.banquet_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_resources_authenticated ON public.banquet_resources;
CREATE POLICY banquet_resources_authenticated ON public.banquet_resources
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_resources TO authenticated;

ALTER TABLE public.banquet_equipment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_equipment_authenticated ON public.banquet_equipment;
CREATE POLICY banquet_equipment_authenticated ON public.banquet_equipment
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_equipment TO authenticated;

ALTER TABLE public.banquet_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_vendors_authenticated ON public.banquet_vendors;
CREATE POLICY banquet_vendors_authenticated ON public.banquet_vendors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_vendors TO authenticated;

ALTER TABLE public.banquet_transportation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_transportation_authenticated ON public.banquet_transportation;
CREATE POLICY banquet_transportation_authenticated ON public.banquet_transportation
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_transportation TO authenticated;

-- Checklist templates (migration 447)
ALTER TABLE public.banquet_checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_checklist_templates_authenticated ON public.banquet_checklist_templates;
CREATE POLICY banquet_checklist_templates_authenticated ON public.banquet_checklist_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_checklist_templates TO authenticated;

-- Execution issues (migration 448)
ALTER TABLE public.banquet_event_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_issues_authenticated ON public.banquet_event_issues;
CREATE POLICY banquet_event_issues_authenticated ON public.banquet_event_issues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_issues TO authenticated;

-- Coordination & communications (migration 449)
ALTER TABLE public.banquet_dept_coordination ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_dept_coordination_authenticated ON public.banquet_dept_coordination;
CREATE POLICY banquet_dept_coordination_authenticated ON public.banquet_dept_coordination
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_dept_coordination TO authenticated;

ALTER TABLE public.banquet_communications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_communications_authenticated ON public.banquet_communications;
CREATE POLICY banquet_communications_authenticated ON public.banquet_communications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_communications TO authenticated;

-- Guest experience (migration 450)
ALTER TABLE public.banquet_event_guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_guests_authenticated ON public.banquet_event_guests;
CREATE POLICY banquet_event_guests_authenticated ON public.banquet_event_guests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_guests TO authenticated;

ALTER TABLE public.banquet_event_registrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_registrations_authenticated ON public.banquet_event_registrations;
CREATE POLICY banquet_event_registrations_authenticated ON public.banquet_event_registrations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_registrations TO authenticated;

ALTER TABLE public.banquet_event_seating ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_seating_authenticated ON public.banquet_event_seating;
CREATE POLICY banquet_event_seating_authenticated ON public.banquet_event_seating
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_seating TO authenticated;

-- Reports (migrations 452–453)
ALTER TABLE public.banquet_event_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_reports_authenticated ON public.banquet_event_reports;
CREATE POLICY banquet_event_reports_authenticated ON public.banquet_event_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_reports TO authenticated;

ALTER TABLE public.banquet_event_report_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banquet_event_report_catalog_authenticated ON public.banquet_event_report_catalog;
CREATE POLICY banquet_event_report_catalog_authenticated ON public.banquet_event_report_catalog
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_report_catalog TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables with RLS already enabled but missing policies (454, 455)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS banquet_event_config_authenticated ON public.banquet_event_config;
CREATE POLICY banquet_event_config_authenticated ON public.banquet_event_config
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_event_config TO authenticated;

DROP POLICY IF EXISTS banquet_staff_authenticated ON public.banquet_staff;
CREATE POLICY banquet_staff_authenticated ON public.banquet_staff
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_staff TO authenticated;

DROP POLICY IF EXISTS banquet_staff_attendance_authenticated ON public.banquet_staff_attendance;
CREATE POLICY banquet_staff_attendance_authenticated ON public.banquet_staff_attendance
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_staff_attendance TO authenticated;

DROP POLICY IF EXISTS banquet_staff_training_authenticated ON public.banquet_staff_training;
CREATE POLICY banquet_staff_training_authenticated ON public.banquet_staff_training
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_staff_training TO authenticated;

DROP POLICY IF EXISTS banquet_staff_productivity_authenticated ON public.banquet_staff_productivity;
CREATE POLICY banquet_staff_productivity_authenticated ON public.banquet_staff_productivity
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_staff_productivity TO authenticated;

DROP POLICY IF EXISTS banquet_staff_shift_reqs_authenticated ON public.banquet_staff_shift_reqs;
CREATE POLICY banquet_staff_shift_reqs_authenticated ON public.banquet_staff_shift_reqs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_staff_shift_reqs TO authenticated;

DROP POLICY IF EXISTS banquet_staff_staffing_reqs_authenticated ON public.banquet_staff_staffing_reqs;
CREATE POLICY banquet_staff_staffing_reqs_authenticated ON public.banquet_staff_staffing_reqs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_staff_staffing_reqs TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Legacy banquet_events is a VIEW over event_bookings (converted in 444), so
-- RLS cannot be applied to it — it inherits the underlying table's security.
-- ─────────────────────────────────────────────────────────────────────────────
