-- Migration 701: Multi-Tenant Phase 2 - Add tenant_id Columns
-- This migration adds tenant_id columns to all data tables that need tenant isolation.
-- Tables that remain global (no tenant_id):
-- - tenants, tenant_user_assignments (tenant infrastructure)
-- - system_users (users can belong to multiple tenants)
-- - user_sessions (has active_tenant_id from Phase 1)
-- - roles, permissions, role_permissions (system-wide RBAC)
-- - organizations (legacy, being replaced by tenants)

-- ============================================================================
-- CORE PROPERTY & ROOM TABLES
-- ============================================================================

-- Properties table: add tenant_id (will map from org_id in Phase 3)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties(tenant_id);

-- Rooms table
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON rooms(tenant_id);

-- ============================================================================
-- GUEST & RESERVATION TABLES
-- ============================================================================

-- Guests table
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guests_tenant ON guests(tenant_id);

-- Reservations table
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON reservations(tenant_id);

-- Group bookings table
ALTER TABLE group_bookings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_bookings_tenant ON group_bookings(tenant_id);

-- Corporate accounts table
ALTER TABLE corporate_accounts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_corporate_accounts_tenant ON corporate_accounts(tenant_id);

-- ============================================================================
-- FOLIO & BILLING TABLES
-- ============================================================================

-- Folios table
ALTER TABLE folios
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_folios_tenant ON folios(tenant_id);

-- Folio lines table
ALTER TABLE folio_lines
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_folio_lines_tenant ON folio_lines(tenant_id);

-- Folio payments table
ALTER TABLE folio_payments
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_folio_payments_tenant ON folio_payments(tenant_id);

-- Chart of accounts (tenant-specific COA)
ALTER TABLE chart_of_accounts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant ON chart_of_accounts(tenant_id);

-- ============================================================================
-- RATE MANAGEMENT TABLES
-- ============================================================================

-- Rate plans table
ALTER TABLE rate_plans
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rate_plans_tenant ON rate_plans(tenant_id);

-- Seasons table
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seasons_tenant ON seasons(tenant_id);

-- Packages table
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_packages_tenant ON packages(tenant_id);

-- Yield policies table
ALTER TABLE yield_policies
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_yield_policies_tenant ON yield_policies(tenant_id);

-- ============================================================================
-- INVENTORY TABLES
-- ============================================================================

-- Inventory stores table
ALTER TABLE inventory_stores
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_stores_tenant ON inventory_stores(tenant_id);

-- Inventory items table
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory_items(tenant_id);

-- Inventory suppliers table
ALTER TABLE inventory_suppliers
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_suppliers_tenant ON inventory_suppliers(tenant_id);

-- Inventory stock movements table
ALTER TABLE inventory_stock_movements
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_stock_movements_tenant ON inventory_stock_movements(tenant_id);

-- Inventory requisitions table
ALTER TABLE inventory_requisitions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_tenant ON inventory_requisitions(tenant_id);

-- Inventory GRNs table
ALTER TABLE inventory_grns
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_grns_tenant ON inventory_grns(tenant_id);

-- ============================================================================
-- GUEST SERVICES TABLES
-- ============================================================================

-- Guest services table
ALTER TABLE guest_services
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_services_tenant ON guest_services(tenant_id);

-- Guest requests table
ALTER TABLE guest_requests
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_requests_tenant ON guest_requests(tenant_id);

-- Guest feedback table
ALTER TABLE guest_feedbacks
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_feedbacks_tenant ON guest_feedbacks(tenant_id);

-- ============================================================================
-- GROUP PROFILES & RELATIONSHIPS
-- ============================================================================

-- Group profiles table
ALTER TABLE group_profiles
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_profiles_tenant ON group_profiles(tenant_id);

-- Guest group relationships table
ALTER TABLE guest_group_relationships
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_group_relationships_tenant ON guest_group_relationships(tenant_id);

-- Group audit log table
ALTER TABLE group_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_audit_log_tenant ON group_audit_log(tenant_id);

-- ============================================================================
-- SYSTEM & AUDIT TABLES
-- ============================================================================

-- Audit events table
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);

-- Custom roles table (tenant-specific custom roles)
ALTER TABLE custom_roles
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_custom_roles_tenant ON custom_roles(tenant_id);

-- Global settings table (add tenant_id for per-tenant settings, but keep global defaults)
ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_global_settings_tenant ON global_settings(tenant_id);

-- ============================================================================
-- HOUSEKEEPING TABLES
-- ============================================================================

-- Housekeeping task management table
ALTER TABLE housekeeping_task_mgmt
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_housekeeping_task_mgmt_tenant ON housekeeping_task_mgmt(tenant_id);

-- Housekeeping linen stock table
ALTER TABLE hk_linen_stock
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hk_linen_stock_tenant ON hk_linen_stock(tenant_id);

-- Housekeeping amenity stock table
ALTER TABLE hk_amenity_stock
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hk_amenity_stock_tenant ON hk_amenity_stock(tenant_id);

-- Housekeeping maintenance issues table
ALTER TABLE housekeeping_maintenance_issues
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_housekeeping_maintenance_issues_tenant ON housekeeping_maintenance_issues(tenant_id);

-- Housekeeping communication messages table
ALTER TABLE housekeeping_communication_messages
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_housekeeping_communication_messages_tenant ON housekeeping_communication_messages(tenant_id);

-- ============================================================================
-- FOOD & BEVERAGE TABLES
-- ============================================================================

-- Outlets table
ALTER TABLE outlets
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outlets_tenant ON outlets(tenant_id);

-- Ingredients table
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredients_tenant ON ingredients(tenant_id);

-- Menu items table
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_tenant ON menu_items(tenant_id);

-- Recipes table
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes(tenant_id);

-- Stock locations table
ALTER TABLE stock_locations
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_locations_tenant ON stock_locations(tenant_id);

-- Stock transactions table
ALTER TABLE stock_transactions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_transactions_tenant ON stock_transactions(tenant_id);

-- Requisitions table (F&B)
ALTER TABLE requisitions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_requisitions_tenant ON requisitions(tenant_id);

-- Orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);

-- Banquet events table (skip if it's a view)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'banquet_events' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE banquet_events
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_banquet_events_tenant ON banquet_events(tenant_id);
  END IF;
END $$;

-- Wastage logs table
ALTER TABLE wastage_logs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wastage_logs_tenant ON wastage_logs(tenant_id);

-- Stock counts table
ALTER TABLE stock_counts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_counts_tenant ON stock_counts(tenant_id);

-- ============================================================================
-- ENGINEERING TABLES
-- ============================================================================

-- Work orders table
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON work_orders(tenant_id);

-- PM schedules table
ALTER TABLE pm_schedules
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pm_schedules_tenant ON pm_schedules(tenant_id);

-- Spare parts table
ALTER TABLE spare_parts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spare_parts_tenant ON spare_parts(tenant_id);

-- ============================================================================
-- SPA TABLES
-- ============================================================================

-- Spa appointments table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'spa_appointments') THEN
    ALTER TABLE spa_appointments
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_spa_appointments_tenant ON spa_appointments(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- TRANSPORT TABLES
-- ============================================================================

-- Transport requests table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transport_requests') THEN
    ALTER TABLE transport_requests
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_transport_requests_tenant ON transport_requests(tenant_id);
  END IF;
END $$;

-- Airport shuttle requests table
ALTER TABLE airport_shuttle_requests
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_airport_shuttle_requests_tenant ON airport_shuttle_requests(tenant_id);

-- ============================================================================
-- OPERATIONS TABLES
-- ============================================================================

-- Daily briefing table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_briefing' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE daily_briefing
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_daily_briefing_tenant ON daily_briefing(tenant_id);
  END IF;
END $$;

-- Action items table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'action_item' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE action_item
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_action_item_tenant ON action_item(tenant_id);
  END IF;
END $$;

-- Staffing status table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'staffing_status' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE staffing_status
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_staffing_status_tenant ON staffing_status(tenant_id);
  END IF;
END $$;

-- Escalation table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'escalation' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE escalation
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_escalation_tenant ON escalation(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- SECURITY TABLES
-- ============================================================================

-- Security incident management table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'security_incidents') THEN
    ALTER TABLE security_incidents
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_security_incidents_tenant ON security_incidents(tenant_id);
  END IF;
END $$;

-- Lost found table
ALTER TABLE lost_found
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lost_found_tenant ON lost_found(tenant_id);

-- ============================================================================
-- SALES TABLES
-- ============================================================================

-- Sales leads table
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_leads_tenant ON sales_leads(tenant_id);

-- Sales proposals table
ALTER TABLE sales_proposals
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_proposals_tenant ON sales_proposals(tenant_id);

-- Sales contracts table
ALTER TABLE sales_contracts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_contracts_tenant ON sales_contracts(tenant_id);

-- Group blocks table
ALTER TABLE group_blocks
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_blocks_tenant ON group_blocks(tenant_id);

-- ============================================================================
-- HR TABLES
-- ============================================================================

-- Employee records table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees') THEN
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- FINANCE TABLES
-- ============================================================================

-- Journal entries table
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant ON journal_entries(tenant_id);

-- Journal lines table
ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant ON journal_lines(tenant_id);

-- Vendors table
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON vendors(tenant_id);

-- AP bills table
ALTER TABLE ap_bills
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ap_bills_tenant ON ap_bills(tenant_id);

-- AP payments table
ALTER TABLE ap_payments
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ap_payments_tenant ON ap_payments(tenant_id);

-- Bank accounts table (finance)
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant ON bank_accounts(tenant_id);

-- Bank statement lines table
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_tenant ON bank_statement_lines(tenant_id);

-- Reconciliation batches table
ALTER TABLE reconciliation_batches
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_tenant ON reconciliation_batches(tenant_id);

-- Fixed assets table
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_assets_tenant ON fixed_assets(tenant_id);

-- Depreciation schedules table
ALTER TABLE depreciation_schedules
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_tenant ON depreciation_schedules(tenant_id);

-- Accounting periods table
ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_periods_tenant ON accounting_periods(tenant_id);

-- ============================================================================
-- EXECUTIVE / BI TABLES
-- ============================================================================

-- Metric definitions table
ALTER TABLE metric_definitions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_metric_definitions_tenant ON metric_definitions(tenant_id);

-- Reporting snapshots table
ALTER TABLE reporting_snapshots
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reporting_snapshots_tenant ON reporting_snapshots(tenant_id);

-- Metric history table
ALTER TABLE metric_history
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_metric_history_tenant ON metric_history(tenant_id);

-- Alert rules table
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id);

-- Alert instances table
ALTER TABLE alert_instances
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alert_instances_tenant ON alert_instances(tenant_id);

-- Dashboard views table
ALTER TABLE dashboard_views
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_views_tenant ON dashboard_views(tenant_id);

-- Report schedules table
ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_report_schedules_tenant ON report_schedules(tenant_id);

-- Drill down links table
ALTER TABLE drill_down_links
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_drill_down_links_tenant ON drill_down_links(tenant_id);

-- Forecast entries table
ALTER TABLE forecast_entries
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forecast_entries_tenant ON forecast_entries(tenant_id);

-- ============================================================================
-- GUEST PORTAL TABLES
-- ============================================================================

-- Guest sessions table (already has guest_id, add tenant_id for guest's tenant)
ALTER TABLE guest_sessions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_tenant ON guest_sessions(tenant_id);

-- Guest notifications table
ALTER TABLE guest_notifications
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_notifications_tenant ON guest_notifications(tenant_id);

-- Guest digital keys table
ALTER TABLE digital_keys
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_digital_keys_tenant ON digital_keys(tenant_id);

-- Guest mobile check-ins table
ALTER TABLE mobile_check_ins
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_check_ins_tenant ON mobile_check_ins(tenant_id);

-- Guest FAQs table
ALTER TABLE guest_faqs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_faqs_tenant ON guest_faqs(tenant_id);

-- ============================================================================
-- UNIFIED INVENTORY TABLES
-- ============================================================================

-- Unified inventory tables (if they exist)
DO $$
BEGIN
  -- uinv_stock_balances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_balances') THEN
    ALTER TABLE uinv_stock_balances
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_stock_balances_tenant ON uinv_stock_balances(tenant_id);
  END IF;

  -- uinv_stock_ledger
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_ledger') THEN
    ALTER TABLE uinv_stock_ledger
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_stock_ledger_tenant ON uinv_stock_ledger(tenant_id);
  END IF;

  -- uinv_items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_items') THEN
    ALTER TABLE uinv_items
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_items_tenant ON uinv_items(tenant_id);
  END IF;

  -- uinv_stores
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stores') THEN
    ALTER TABLE uinv_stores
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_stores_tenant ON uinv_stores(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION 701
-- ============================================================================
