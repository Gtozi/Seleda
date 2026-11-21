-- Migration 701: Multi-Tenant Phase 2 - Add tenant_id Columns (Defensive Version)
-- This migration adds tenant_id columns to all data tables that need tenant isolation.
-- Each ALTER TABLE is wrapped in a defensive check to handle missing tables or views.

-- ============================================================================
-- CORE PROPERTY & ROOM TABLES
-- ============================================================================

-- Properties table: add tenant_id (will map from org_id in Phase 3)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'properties' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE properties
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties(tenant_id);
  END IF;
END $$;

-- Rooms table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rooms' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON rooms(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- GUEST & RESERVATION TABLES
-- ============================================================================

-- Guests table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guests' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guests
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guests_tenant ON guests(tenant_id);
  END IF;
END $$;

-- Reservations table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reservations' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE reservations
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_reservations_tenant ON reservations(tenant_id);
  END IF;
END $$;

-- Group bookings table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_bookings' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE group_bookings
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_group_bookings_tenant ON group_bookings(tenant_id);
  END IF;
END $$;

-- Corporate accounts table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'corporate_accounts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE corporate_accounts
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_corporate_accounts_tenant ON corporate_accounts(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- FOLIO & BILLING TABLES
-- ============================================================================

-- Folios table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'folios' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE folios
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_folios_tenant ON folios(tenant_id);
  END IF;
END $$;

-- Folio lines table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'folio_lines' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE folio_lines
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_folio_lines_tenant ON folio_lines(tenant_id);
  END IF;
END $$;

-- Folio payments table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'folio_payments' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE folio_payments
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_folio_payments_tenant ON folio_payments(tenant_id);
  END IF;
END $$;

-- Chart of accounts (tenant-specific COA)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chart_of_accounts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE chart_of_accounts
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant ON chart_of_accounts(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- RATE MANAGEMENT TABLES
-- ============================================================================

-- Rate plans table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rate_plans' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE rate_plans
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_rate_plans_tenant ON rate_plans(tenant_id);
  END IF;
END $$;

-- Seasons table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seasons' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE seasons
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_seasons_tenant ON seasons(tenant_id);
  END IF;
END $$;

-- Packages table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'packages' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE packages
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_packages_tenant ON packages(tenant_id);
  END IF;
END $$;

-- Yield policies table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'yield_policies' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE yield_policies
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_yield_policies_tenant ON yield_policies(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- INVENTORY TABLES
-- ============================================================================

-- Inventory stores table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_stores' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE inventory_stores
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_stores_tenant ON inventory_stores(tenant_id);
  END IF;
END $$;

-- Inventory items table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_items' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory_items(tenant_id);
  END IF;
END $$;

-- Inventory suppliers table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_suppliers' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE inventory_suppliers
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_suppliers_tenant ON inventory_suppliers(tenant_id);
  END IF;
END $$;

-- Inventory stock movements table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_stock_movements' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE inventory_stock_movements
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_stock_movements_tenant ON inventory_stock_movements(tenant_id);
  END IF;
END $$;

-- Inventory requisitions table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_requisitions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE inventory_requisitions
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_requisitions_tenant ON inventory_requisitions(tenant_id);
  END IF;
END $$;

-- Inventory GRNs table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_grns' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE inventory_grns
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_inventory_grns_tenant ON inventory_grns(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- GUEST SERVICES TABLES
-- ============================================================================

-- Guest services table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_services' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_services
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_services_tenant ON guest_services(tenant_id);
  END IF;
END $$;

-- Guest requests table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_requests' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_requests
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_requests_tenant ON guest_requests(tenant_id);
  END IF;
END $$;

-- Guest feedback table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_feedbacks' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_feedbacks
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_feedbacks_tenant ON guest_feedbacks(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- GROUP PROFILES & RELATIONSHIPS
-- ============================================================================

-- Group profiles table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_profiles' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE group_profiles
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_group_profiles_tenant ON group_profiles(tenant_id);
  END IF;
END $$;

-- Guest group relationships table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_group_relationships' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_group_relationships
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_group_relationships_tenant ON guest_group_relationships(tenant_id);
  END IF;
END $$;

-- Group audit log table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_audit_log' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE group_audit_log
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_group_audit_log_tenant ON group_audit_log(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- SYSTEM & AUDIT TABLES
-- ============================================================================

-- Audit events table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE audit_events
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
  END IF;
END $$;

-- Custom roles table (tenant-specific custom roles)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'custom_roles' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE custom_roles
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_custom_roles_tenant ON custom_roles(tenant_id);
  END IF;
END $$;

-- Global settings table (add tenant_id for per-tenant settings, but keep global defaults)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'global_settings' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE global_settings
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_global_settings_tenant ON global_settings(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- HOUSEKEEPING TABLES
-- ============================================================================

-- Housekeeping task management table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_task_mgmt' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE housekeeping_task_mgmt
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_housekeeping_task_mgmt_tenant ON housekeeping_task_mgmt(tenant_id);
  END IF;
END $$;

-- Housekeeping linen stock table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hk_linen_stock' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE hk_linen_stock
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_hk_linen_stock_tenant ON hk_linen_stock(tenant_id);
  END IF;
END $$;

-- Housekeeping amenity stock table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hk_amenity_stock' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE hk_amenity_stock
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_hk_amenity_stock_tenant ON hk_amenity_stock(tenant_id);
  END IF;
END $$;

-- Housekeeping maintenance issues table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_maintenance_issues' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE housekeeping_maintenance_issues
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_housekeeping_maintenance_issues_tenant ON housekeeping_maintenance_issues(tenant_id);
  END IF;
END $$;

-- Housekeeping communication messages table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_communication_messages' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE housekeeping_communication_messages
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_housekeeping_communication_messages_tenant ON housekeeping_communication_messages(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- FOOD & BEVERAGE TABLES
-- ============================================================================

-- Outlets table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outlets' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE outlets
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_outlets_tenant ON outlets(tenant_id);
  END IF;
END $$;

-- Ingredients table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingredients' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE ingredients
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_ingredients_tenant ON ingredients(tenant_id);
  END IF;
END $$;

-- Menu items table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_items' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE menu_items
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_menu_items_tenant ON menu_items(tenant_id);
  END IF;
END $$;

-- Recipes table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recipes' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes(tenant_id);
  END IF;
END $$;

-- Stock locations table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_locations' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE stock_locations
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_locations_tenant ON stock_locations(tenant_id);
  END IF;
END $$;

-- Stock transactions table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_transactions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE stock_transactions
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_transactions_tenant ON stock_transactions(tenant_id);
  END IF;
END $$;

-- Requisitions table (F&B)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'requisitions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE requisitions
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_requisitions_tenant ON requisitions(tenant_id);
  END IF;
END $$;

-- Orders table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
  END IF;
END $$;

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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wastage_logs' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE wastage_logs
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_wastage_logs_tenant ON wastage_logs(tenant_id);
  END IF;
END $$;

-- Stock counts table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_counts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE stock_counts
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_counts_tenant ON stock_counts(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- ENGINEERING TABLES
-- ============================================================================

-- Work orders table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE work_orders
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON work_orders(tenant_id);
  END IF;
END $$;

-- PM schedules table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_schedules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE pm_schedules
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_pm_schedules_tenant ON pm_schedules(tenant_id);
  END IF;
END $$;

-- Spare parts table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'spare_parts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE spare_parts
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_spare_parts_tenant ON spare_parts(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- SPA TABLES
-- ============================================================================

-- Spa appointments table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'spa_appointments' AND table_type = 'BASE TABLE') THEN
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
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transport_requests' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE transport_requests
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_transport_requests_tenant ON transport_requests(tenant_id);
  END IF;
END $$;

-- Airport shuttle requests table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'airport_shuttle_requests' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE airport_shuttle_requests
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_airport_shuttle_requests_tenant ON airport_shuttle_requests(tenant_id);
  END IF;
END $$;

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
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'security_incidents' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE security_incidents
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_security_incidents_tenant ON security_incidents(tenant_id);
  END IF;
END $$;

-- Lost found table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lost_found' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE lost_found
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_lost_found_tenant ON lost_found(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- SALES TABLES
-- ============================================================================

-- Sales leads table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_leads' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE sales_leads
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_leads_tenant ON sales_leads(tenant_id);
  END IF;
END $$;

-- Sales proposals table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_proposals' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE sales_proposals
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_proposals_tenant ON sales_proposals(tenant_id);
  END IF;
END $$;

-- Sales contracts table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_contracts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE sales_contracts
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_contracts_tenant ON sales_contracts(tenant_id);
  END IF;
END $$;

-- Group blocks table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_blocks' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE group_blocks
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_group_blocks_tenant ON group_blocks(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- HR TABLES
-- ============================================================================

-- Employee records table (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- FINANCE TABLES
-- ============================================================================

-- Journal entries table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE journal_entries
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant ON journal_entries(tenant_id);
  END IF;
END $$;

-- Journal lines table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_lines' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE journal_lines
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant ON journal_lines(tenant_id);
  END IF;
END $$;

-- Vendors table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE vendors
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON vendors(tenant_id);
  END IF;
END $$;

-- AP bills table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ap_bills' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE ap_bills
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_ap_bills_tenant ON ap_bills(tenant_id);
  END IF;
END $$;

-- AP payments table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ap_payments' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE ap_payments
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_ap_payments_tenant ON ap_payments(tenant_id);
  END IF;
END $$;

-- Bank accounts table (finance)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_accounts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE bank_accounts
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_tenant ON bank_accounts(tenant_id);
  END IF;
END $$;

-- Bank statement lines table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_statement_lines' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE bank_statement_lines
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_tenant ON bank_statement_lines(tenant_id);
  END IF;
END $$;

-- Reconciliation batches table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reconciliation_batches' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE reconciliation_batches
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_tenant ON reconciliation_batches(tenant_id);
  END IF;
END $$;

-- Fixed assets table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fixed_assets' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE fixed_assets
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_fixed_assets_tenant ON fixed_assets(tenant_id);
  END IF;
END $$;

-- Depreciation schedules table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'depreciation_schedules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE depreciation_schedules
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_depreciation_schedules_tenant ON depreciation_schedules(tenant_id);
  END IF;
END $$;

-- Accounting periods table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_periods' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE accounting_periods
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_accounting_periods_tenant ON accounting_periods(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- EXECUTIVE / BI TABLES
-- ============================================================================

-- Metric definitions table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_definitions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE metric_definitions
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_metric_definitions_tenant ON metric_definitions(tenant_id);
  END IF;
END $$;

-- Reporting snapshots table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reporting_snapshots' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE reporting_snapshots
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_reporting_snapshots_tenant ON reporting_snapshots(tenant_id);
  END IF;
END $$;

-- Metric history table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_history' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE metric_history
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_metric_history_tenant ON metric_history(tenant_id);
  END IF;
END $$;

-- Alert rules table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_rules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE alert_rules
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id);
  END IF;
END $$;

-- Alert instances table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_instances' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE alert_instances
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_alert_instances_tenant ON alert_instances(tenant_id);
  END IF;
END $$;

-- Dashboard views table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dashboard_views' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE dashboard_views
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_dashboard_views_tenant ON dashboard_views(tenant_id);
  END IF;
END $$;

-- Report schedules table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_schedules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE report_schedules
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_report_schedules_tenant ON report_schedules(tenant_id);
  END IF;
END $$;

-- Drill down links table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'drill_down_links' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE drill_down_links
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_drill_down_links_tenant ON drill_down_links(tenant_id);
  END IF;
END $$;

-- Forecast entries table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forecast_entries' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE forecast_entries
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_forecast_entries_tenant ON forecast_entries(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- GUEST PORTAL TABLES
-- ============================================================================

-- Guest sessions table (already has guest_id, add tenant_id for guest's tenant)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_sessions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_sessions
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_sessions_tenant ON guest_sessions(tenant_id);
  END IF;
END $$;

-- Guest notifications table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_notifications' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_notifications
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_notifications_tenant ON guest_notifications(tenant_id);
  END IF;
END $$;

-- Guest digital keys table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'digital_keys' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE digital_keys
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_digital_keys_tenant ON digital_keys(tenant_id);
  END IF;
END $$;

-- Guest mobile check-ins table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mobile_check_ins' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE mobile_check_ins
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_mobile_check_ins_tenant ON mobile_check_ins(tenant_id);
  END IF;
END $$;

-- Guest FAQs table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_faqs' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_faqs
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_guest_faqs_tenant ON guest_faqs(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- UNIFIED INVENTORY TABLES
-- ============================================================================

-- Unified inventory tables (if they exist)
DO $$
BEGIN
  -- uinv_stock_balances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_balances' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_stock_balances
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_stock_balances_tenant ON uinv_stock_balances(tenant_id);
  END IF;

  -- uinv_stock_ledger
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_ledger' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_stock_ledger
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_stock_ledger_tenant ON uinv_stock_ledger(tenant_id);
  END IF;

  -- uinv_items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_items' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_items
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_items_tenant ON uinv_items(tenant_id);
  END IF;

  -- uinv_stores
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stores' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_stores
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_uinv_stores_tenant ON uinv_stores(tenant_id);
  END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION 701
-- ============================================================================
