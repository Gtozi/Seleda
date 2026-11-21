-- Migration 703: Multi-Tenant Phase 4 - RLS Policies
-- This migration adds Row Level Security policies to enforce tenant isolation
-- on all tenant-scoped tables.

-- ============================================================================
-- HELPER FUNCTION FOR TENANT ISOLATION POLICIES
-- ============================================================================

-- This function is used by RLS policies to check if a row belongs to the current tenant
CREATE OR REPLACE FUNCTION check_tenant_access(p_table_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_tenant_id UUID;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Get current tenant from session
  SELECT get_current_tenant_id() INTO v_current_tenant_id;

  -- Check if user is super admin
  SELECT is_current_user_super_admin() INTO v_is_super_admin;

  -- Super admins can access all tenants (for cross-tenant operations)
  IF v_is_super_admin THEN
    RETURN true;
  END IF;

  -- Regular users can only access their current tenant's data
  RETURN p_table_tenant_id = v_current_tenant_id;
END;
$$;

COMMENT ON FUNCTION check_tenant_access(p_table_tenant_id UUID) IS 'RLS helper function to check if the current user has access to a row based on tenant_id. Super-admins bypass tenant restrictions.';

-- ============================================================================
-- CORE PROPERTY & ROOM TABLES
-- ============================================================================

-- Properties table
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_tenant_read" ON properties;
CREATE POLICY "properties_tenant_read" ON properties
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "properties_tenant_write" ON properties;
CREATE POLICY "properties_tenant_write" ON properties
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Rooms table
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rooms_tenant_read" ON rooms;
CREATE POLICY "rooms_tenant_read" ON rooms
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "rooms_tenant_write" ON rooms;
CREATE POLICY "rooms_tenant_write" ON rooms
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- GUEST & RESERVATION TABLES
-- ============================================================================

-- Guests table
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guests_tenant_read" ON guests;
CREATE POLICY "guests_tenant_read" ON guests
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "guests_tenant_write" ON guests;
CREATE POLICY "guests_tenant_write" ON guests
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Reservations table
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations_tenant_read" ON reservations;
CREATE POLICY "reservations_tenant_read" ON reservations
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "reservations_tenant_write" ON reservations;
CREATE POLICY "reservations_tenant_write" ON reservations
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Group bookings table
ALTER TABLE group_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_bookings_tenant_read" ON group_bookings;
CREATE POLICY "group_bookings_tenant_read" ON group_bookings
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "group_bookings_tenant_write" ON group_bookings;
CREATE POLICY "group_bookings_tenant_write" ON group_bookings
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Corporate accounts table
ALTER TABLE corporate_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "corporate_accounts_tenant_read" ON corporate_accounts;
CREATE POLICY "corporate_accounts_tenant_read" ON corporate_accounts
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "corporate_accounts_tenant_write" ON corporate_accounts;
CREATE POLICY "corporate_accounts_tenant_write" ON corporate_accounts
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- FOLIO & BILLING TABLES
-- ============================================================================

-- Folios table
ALTER TABLE folios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "folios_tenant_read" ON folios;
CREATE POLICY "folios_tenant_read" ON folios
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "folios_tenant_write" ON folios;
CREATE POLICY "folios_tenant_write" ON folios
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Folio lines table
ALTER TABLE folio_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "folio_lines_tenant_read" ON folio_lines;
CREATE POLICY "folio_lines_tenant_read" ON folio_lines
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "folio_lines_tenant_write" ON folio_lines;
CREATE POLICY "folio_lines_tenant_write" ON folio_lines
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Folio payments table
ALTER TABLE folio_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "folio_payments_tenant_read" ON folio_payments;
CREATE POLICY "folio_payments_tenant_read" ON folio_payments
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "folio_payments_tenant_write" ON folio_payments;
CREATE POLICY "folio_payments_tenant_write" ON folio_payments
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Chart of accounts table
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chart_of_accounts_tenant_read" ON chart_of_accounts;
CREATE POLICY "chart_of_accounts_tenant_read" ON chart_of_accounts
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "chart_of_accounts_tenant_write" ON chart_of_accounts;
CREATE POLICY "chart_of_accounts_tenant_write" ON chart_of_accounts
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- RATE MANAGEMENT TABLES
-- ============================================================================

-- Rate plans table
ALTER TABLE rate_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_plans_tenant_read" ON rate_plans;
CREATE POLICY "rate_plans_tenant_read" ON rate_plans
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "rate_plans_tenant_write" ON rate_plans;
CREATE POLICY "rate_plans_tenant_write" ON rate_plans
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Seasons table
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seasons_tenant_read" ON seasons;
CREATE POLICY "seasons_tenant_read" ON seasons
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "seasons_tenant_write" ON seasons;
CREATE POLICY "seasons_tenant_write" ON seasons
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Packages table
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "packages_tenant_read" ON packages;
CREATE POLICY "packages_tenant_read" ON packages
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "packages_tenant_write" ON packages;
CREATE POLICY "packages_tenant_write" ON packages
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Yield policies table
ALTER TABLE yield_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "yield_policies_tenant_read" ON yield_policies;
CREATE POLICY "yield_policies_tenant_read" ON yield_policies
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "yield_policies_tenant_write" ON yield_policies;
CREATE POLICY "yield_policies_tenant_write" ON yield_policies
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- INVENTORY TABLES
-- ============================================================================

-- Inventory stores table
ALTER TABLE inventory_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_stores_tenant_read" ON inventory_stores;
CREATE POLICY "inventory_stores_tenant_read" ON inventory_stores
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "inventory_stores_tenant_write" ON inventory_stores;
CREATE POLICY "inventory_stores_tenant_write" ON inventory_stores
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Inventory items table
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_items_tenant_read" ON inventory_items;
CREATE POLICY "inventory_items_tenant_read" ON inventory_items
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "inventory_items_tenant_write" ON inventory_items;
CREATE POLICY "inventory_items_tenant_write" ON inventory_items
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Inventory suppliers table
ALTER TABLE inventory_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_suppliers_tenant_read" ON inventory_suppliers;
CREATE POLICY "inventory_suppliers_tenant_read" ON inventory_suppliers
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "inventory_suppliers_tenant_write" ON inventory_suppliers;
CREATE POLICY "inventory_suppliers_tenant_write" ON inventory_suppliers
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Inventory stock movements table
ALTER TABLE inventory_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_stock_movements_tenant_read" ON inventory_stock_movements;
CREATE POLICY "inventory_stock_movements_tenant_read" ON inventory_stock_movements
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "inventory_stock_movements_tenant_write" ON inventory_stock_movements;
CREATE POLICY "inventory_stock_movements_tenant_write" ON inventory_stock_movements
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Inventory requisitions table
ALTER TABLE inventory_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_requisitions_tenant_read" ON inventory_requisitions;
CREATE POLICY "inventory_requisitions_tenant_read" ON inventory_requisitions
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "inventory_requisitions_tenant_write" ON inventory_requisitions;
CREATE POLICY "inventory_requisitions_tenant_write" ON inventory_requisitions
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Inventory GRNs table
ALTER TABLE inventory_grns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_grns_tenant_read" ON inventory_grns;
CREATE POLICY "inventory_grns_tenant_read" ON inventory_grns
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "inventory_grns_tenant_write" ON inventory_grns;
CREATE POLICY "inventory_grns_tenant_write" ON inventory_grns
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- GUEST SERVICES TABLES
-- ============================================================================

-- Guest services table
ALTER TABLE guest_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guest_services_tenant_read" ON guest_services;
CREATE POLICY "guest_services_tenant_read" ON guest_services
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "guest_services_tenant_write" ON guest_services;
CREATE POLICY "guest_services_tenant_write" ON guest_services
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Guest requests table
ALTER TABLE guest_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guest_requests_tenant_read" ON guest_requests;
CREATE POLICY "guest_requests_tenant_read" ON guest_requests
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "guest_requests_tenant_write" ON guest_requests;
CREATE POLICY "guest_requests_tenant_write" ON guest_requests
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Guest feedback table
ALTER TABLE guest_feedbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guest_feedbacks_tenant_read" ON guest_feedbacks;
CREATE POLICY "guest_feedbacks_tenant_read" ON guest_feedbacks
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "guest_feedbacks_tenant_write" ON guest_feedbacks;
CREATE POLICY "guest_feedbacks_tenant_write" ON guest_feedbacks
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- GROUP PROFILES & RELATIONSHIPS
-- ============================================================================

-- Group profiles table
ALTER TABLE group_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_profiles_tenant_read" ON group_profiles;
CREATE POLICY "group_profiles_tenant_read" ON group_profiles
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "group_profiles_tenant_write" ON group_profiles;
CREATE POLICY "group_profiles_tenant_write" ON group_profiles
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Guest group relationships table
ALTER TABLE guest_group_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guest_group_relationships_tenant_read" ON guest_group_relationships;
CREATE POLICY "guest_group_relationships_tenant_read" ON guest_group_relationships
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "guest_group_relationships_tenant_write" ON guest_group_relationships;
CREATE POLICY "guest_group_relationships_tenant_write" ON guest_group_relationships
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Group audit log table
ALTER TABLE group_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_audit_log_tenant_read" ON group_audit_log;
CREATE POLICY "group_audit_log_tenant_read" ON group_audit_log
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "group_audit_log_tenant_write" ON group_audit_log;
CREATE POLICY "group_audit_log_tenant_write" ON group_audit_log
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- ============================================================================
-- SYSTEM & AUDIT TABLES
-- ============================================================================

-- Audit events table
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_events_tenant_read" ON audit_events;
CREATE POLICY "audit_events_tenant_read" ON audit_events
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "audit_events_tenant_write" ON audit_events;
CREATE POLICY "audit_events_tenant_write" ON audit_events
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Custom roles table
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_roles_tenant_read" ON custom_roles;
CREATE POLICY "custom_roles_tenant_read" ON custom_roles
  FOR SELECT TO authenticated
  USING (check_tenant_access(tenant_id));

DROP POLICY IF EXISTS "custom_roles_tenant_write" ON custom_roles;
CREATE POLICY "custom_roles_tenant_write" ON custom_roles
  FOR ALL TO authenticated
  USING (check_tenant_access(tenant_id))
  WITH CHECK (check_tenant_access(tenant_id));

-- Global settings table - allow read for all, but write only for current tenant
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_settings_read_all" ON global_settings;
CREATE POLICY "global_settings_read_all" ON global_settings
  FOR SELECT TO authenticated
  USING (true);  -- All users can read global settings

DROP POLICY IF EXISTS "global_settings_write_tenant" ON global_settings;
CREATE POLICY "global_settings_write_tenant" ON global_settings
  FOR ALL TO authenticated
  USING (
    tenant_id IS NULL OR check_tenant_access(tenant_id)
  )
  WITH CHECK (
    tenant_id IS NULL OR check_tenant_access(tenant_id)
  );

-- ============================================================================
-- HOUSEKEEPING TABLES
-- ============================================================================

DO $$
BEGIN
  -- Housekeeping task management
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_task_mgmt' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE housekeeping_task_mgmt ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "housekeeping_task_mgmt_tenant_read" ON housekeeping_task_mgmt;
    CREATE POLICY "housekeeping_task_mgmt_tenant_read" ON housekeeping_task_mgmt
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "housekeeping_task_mgmt_tenant_write" ON housekeeping_task_mgmt;
    CREATE POLICY "housekeeping_task_mgmt_tenant_write" ON housekeeping_task_mgmt
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- HK linen stock
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hk_linen_stock' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE hk_linen_stock ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "hk_linen_stock_tenant_read" ON hk_linen_stock;
    CREATE POLICY "hk_linen_stock_tenant_read" ON hk_linen_stock
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "hk_linen_stock_tenant_write" ON hk_linen_stock;
    CREATE POLICY "hk_linen_stock_tenant_write" ON hk_linen_stock
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- HK amenity stock
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hk_amenity_stock' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE hk_amenity_stock ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "hk_amenity_stock_tenant_read" ON hk_amenity_stock;
    CREATE POLICY "hk_amenity_stock_tenant_read" ON hk_amenity_stock
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "hk_amenity_stock_tenant_write" ON hk_amenity_stock;
    CREATE POLICY "hk_amenity_stock_tenant_write" ON hk_amenity_stock
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Housekeeping maintenance issues
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_maintenance_issues' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE housekeeping_maintenance_issues ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "housekeeping_maintenance_issues_tenant_read" ON housekeeping_maintenance_issues;
    CREATE POLICY "housekeeping_maintenance_issues_tenant_read" ON housekeeping_maintenance_issues
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "housekeeping_maintenance_issues_tenant_write" ON housekeeping_maintenance_issues;
    CREATE POLICY "housekeeping_maintenance_issues_tenant_write" ON housekeeping_maintenance_issues
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Housekeeping communication messages
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_communication_messages' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE housekeeping_communication_messages ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "housekeeping_communication_messages_tenant_read" ON housekeeping_communication_messages;
    CREATE POLICY "housekeeping_communication_messages_tenant_read" ON housekeeping_communication_messages
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "housekeeping_communication_messages_tenant_write" ON housekeeping_communication_messages;
    CREATE POLICY "housekeeping_communication_messages_tenant_write" ON housekeeping_communication_messages
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- FOOD & BEVERAGE TABLES
-- ============================================================================

DO $$
BEGIN
  -- Outlets
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outlets' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "outlets_tenant_read" ON outlets;
    CREATE POLICY "outlets_tenant_read" ON outlets
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "outlets_tenant_write" ON outlets;
    CREATE POLICY "outlets_tenant_write" ON outlets
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Ingredients
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingredients' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "ingredients_tenant_read" ON ingredients;
    CREATE POLICY "ingredients_tenant_read" ON ingredients
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "ingredients_tenant_write" ON ingredients;
    CREATE POLICY "ingredients_tenant_write" ON ingredients
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Menu items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_items' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "menu_items_tenant_read" ON menu_items;
    CREATE POLICY "menu_items_tenant_read" ON menu_items
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "menu_items_tenant_write" ON menu_items;
    CREATE POLICY "menu_items_tenant_write" ON menu_items
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Recipes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recipes' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "recipes_tenant_read" ON recipes;
    CREATE POLICY "recipes_tenant_read" ON recipes
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "recipes_tenant_write" ON recipes;
    CREATE POLICY "recipes_tenant_write" ON recipes
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Stock locations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_locations' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "stock_locations_tenant_read" ON stock_locations;
    CREATE POLICY "stock_locations_tenant_read" ON stock_locations
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "stock_locations_tenant_write" ON stock_locations;
    CREATE POLICY "stock_locations_tenant_write" ON stock_locations
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Stock transactions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_transactions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "stock_transactions_tenant_read" ON stock_transactions;
    CREATE POLICY "stock_transactions_tenant_read" ON stock_transactions
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "stock_transactions_tenant_write" ON stock_transactions;
    CREATE POLICY "stock_transactions_tenant_write" ON stock_transactions
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Requisitions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'requisitions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "requisitions_tenant_read" ON requisitions;
    CREATE POLICY "requisitions_tenant_read" ON requisitions
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "requisitions_tenant_write" ON requisitions;
    CREATE POLICY "requisitions_tenant_write" ON requisitions
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "orders_tenant_read" ON orders;
    CREATE POLICY "orders_tenant_read" ON orders
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "orders_tenant_write" ON orders;
    CREATE POLICY "orders_tenant_write" ON orders
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Banquet events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'banquet_events' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE banquet_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "banquet_events_tenant_read" ON banquet_events;
    CREATE POLICY "banquet_events_tenant_read" ON banquet_events
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "banquet_events_tenant_write" ON banquet_events;
    CREATE POLICY "banquet_events_tenant_write" ON banquet_events
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Wastage logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wastage_logs' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE wastage_logs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "wastage_logs_tenant_read" ON wastage_logs;
    CREATE POLICY "wastage_logs_tenant_read" ON wastage_logs
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "wastage_logs_tenant_write" ON wastage_logs;
    CREATE POLICY "wastage_logs_tenant_write" ON wastage_logs
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Stock counts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_counts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "stock_counts_tenant_read" ON stock_counts;
    CREATE POLICY "stock_counts_tenant_read" ON stock_counts
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "stock_counts_tenant_write" ON stock_counts;
    CREATE POLICY "stock_counts_tenant_write" ON stock_counts
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- ENGINEERING TABLES
-- ============================================================================

DO $$
BEGIN
  -- Work orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "work_orders_tenant_read" ON work_orders;
    CREATE POLICY "work_orders_tenant_read" ON work_orders
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "work_orders_tenant_write" ON work_orders;
    CREATE POLICY "work_orders_tenant_write" ON work_orders
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- PM schedules
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_schedules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE pm_schedules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "pm_schedules_tenant_read" ON pm_schedules;
    CREATE POLICY "pm_schedules_tenant_read" ON pm_schedules
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "pm_schedules_tenant_write" ON pm_schedules;
    CREATE POLICY "pm_schedules_tenant_write" ON pm_schedules
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Spare parts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'spare_parts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE spare_parts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "spare_parts_tenant_read" ON spare_parts;
    CREATE POLICY "spare_parts_tenant_read" ON spare_parts
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "spare_parts_tenant_write" ON spare_parts;
    CREATE POLICY "spare_parts_tenant_write" ON spare_parts
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- OPERATIONS TABLES
-- ============================================================================

DO $$
BEGIN
  -- Daily briefing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_briefing' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE daily_briefing ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "daily_briefing_tenant_read" ON daily_briefing;
    CREATE POLICY "daily_briefing_tenant_read" ON daily_briefing
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "daily_briefing_tenant_write" ON daily_briefing;
    CREATE POLICY "daily_briefing_tenant_write" ON daily_briefing
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Action items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'action_item' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE action_item ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "action_item_tenant_read" ON action_item;
    CREATE POLICY "action_item_tenant_read" ON action_item
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "action_item_tenant_write" ON action_item;
    CREATE POLICY "action_item_tenant_write" ON action_item
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Staffing status
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'staffing_status' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE staffing_status ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "staffing_status_tenant_read" ON staffing_status;
    CREATE POLICY "staffing_status_tenant_read" ON staffing_status
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "staffing_status_tenant_write" ON staffing_status;
    CREATE POLICY "staffing_status_tenant_write" ON staffing_status
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Escalation
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'escalation' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE escalation ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "escalation_tenant_read" ON escalation;
    CREATE POLICY "escalation_tenant_read" ON escalation
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "escalation_tenant_write" ON escalation;
    CREATE POLICY "escalation_tenant_write" ON escalation
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- SECURITY TABLES
-- ============================================================================

DO $$
BEGIN
  -- Lost found
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lost_found' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE lost_found ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "lost_found_tenant_read" ON lost_found;
    CREATE POLICY "lost_found_tenant_read" ON lost_found
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "lost_found_tenant_write" ON lost_found;
    CREATE POLICY "lost_found_tenant_write" ON lost_found
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- SALES TABLES
-- ============================================================================

DO $$
BEGIN
  -- Sales leads
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_leads' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "sales_leads_tenant_read" ON sales_leads;
    CREATE POLICY "sales_leads_tenant_read" ON sales_leads
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "sales_leads_tenant_write" ON sales_leads;
    CREATE POLICY "sales_leads_tenant_write" ON sales_leads
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Sales proposals
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_proposals' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE sales_proposals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "sales_proposals_tenant_read" ON sales_proposals;
    CREATE POLICY "sales_proposals_tenant_read" ON sales_proposals
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "sales_proposals_tenant_write" ON sales_proposals;
    CREATE POLICY "sales_proposals_tenant_write" ON sales_proposals
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Sales contracts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_contracts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE sales_contracts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "sales_contracts_tenant_read" ON sales_contracts;
    CREATE POLICY "sales_contracts_tenant_read" ON sales_contracts
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "sales_contracts_tenant_write" ON sales_contracts;
    CREATE POLICY "sales_contracts_tenant_write" ON sales_contracts
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Group blocks
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_blocks' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE group_blocks ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "group_blocks_tenant_read" ON group_blocks;
    CREATE POLICY "group_blocks_tenant_read" ON group_blocks
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "group_blocks_tenant_write" ON group_blocks;
    CREATE POLICY "group_blocks_tenant_write" ON group_blocks
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- FINANCE TABLES
-- ============================================================================

DO $$
BEGIN
  -- Journal entries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "journal_entries_tenant_read" ON journal_entries;
    CREATE POLICY "journal_entries_tenant_read" ON journal_entries
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "journal_entries_tenant_write" ON journal_entries;
    CREATE POLICY "journal_entries_tenant_write" ON journal_entries
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Journal lines
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_lines' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "journal_lines_tenant_read" ON journal_lines;
    CREATE POLICY "journal_lines_tenant_read" ON journal_lines
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "journal_lines_tenant_write" ON journal_lines;
    CREATE POLICY "journal_lines_tenant_write" ON journal_lines
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Vendors
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "vendors_tenant_read" ON vendors;
    CREATE POLICY "vendors_tenant_read" ON vendors
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "vendors_tenant_write" ON vendors;
    CREATE POLICY "vendors_tenant_write" ON vendors
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- AP bills
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ap_bills' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE ap_bills ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "ap_bills_tenant_read" ON ap_bills;
    CREATE POLICY "ap_bills_tenant_read" ON ap_bills
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "ap_bills_tenant_write" ON ap_bills;
    CREATE POLICY "ap_bills_tenant_write" ON ap_bills
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- AP payments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ap_payments' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE ap_payments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "ap_payments_tenant_read" ON ap_payments;
    CREATE POLICY "ap_payments_tenant_read" ON ap_payments
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "ap_payments_tenant_write" ON ap_payments;
    CREATE POLICY "ap_payments_tenant_write" ON ap_payments
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Bank accounts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_accounts' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "bank_accounts_tenant_read" ON bank_accounts;
    CREATE POLICY "bank_accounts_tenant_read" ON bank_accounts
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "bank_accounts_tenant_write" ON bank_accounts;
    CREATE POLICY "bank_accounts_tenant_write" ON bank_accounts
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Bank statement lines
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_statement_lines' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "bank_statement_lines_tenant_read" ON bank_statement_lines;
    CREATE POLICY "bank_statement_lines_tenant_read" ON bank_statement_lines
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "bank_statement_lines_tenant_write" ON bank_statement_lines;
    CREATE POLICY "bank_statement_lines_tenant_write" ON bank_statement_lines
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Reconciliation batches
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reconciliation_batches' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE reconciliation_batches ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "reconciliation_batches_tenant_read" ON reconciliation_batches;
    CREATE POLICY "reconciliation_batches_tenant_read" ON reconciliation_batches
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "reconciliation_batches_tenant_write" ON reconciliation_batches;
    CREATE POLICY "reconciliation_batches_tenant_write" ON reconciliation_batches
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Fixed assets
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fixed_assets' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "fixed_assets_tenant_read" ON fixed_assets;
    CREATE POLICY "fixed_assets_tenant_read" ON fixed_assets
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "fixed_assets_tenant_write" ON fixed_assets;
    CREATE POLICY "fixed_assets_tenant_write" ON fixed_assets
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Depreciation schedules
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'depreciation_schedules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "depreciation_schedules_tenant_read" ON depreciation_schedules;
    CREATE POLICY "depreciation_schedules_tenant_read" ON depreciation_schedules
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "depreciation_schedules_tenant_write" ON depreciation_schedules;
    CREATE POLICY "depreciation_schedules_tenant_write" ON depreciation_schedules
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Accounting periods
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_periods' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "accounting_periods_tenant_read" ON accounting_periods;
    CREATE POLICY "accounting_periods_tenant_read" ON accounting_periods
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "accounting_periods_tenant_write" ON accounting_periods;
    CREATE POLICY "accounting_periods_tenant_write" ON accounting_periods
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- EXECUTIVE / BI TABLES
-- ============================================================================

DO $$
BEGIN
  -- Metric definitions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_definitions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE metric_definitions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "metric_definitions_tenant_read" ON metric_definitions;
    CREATE POLICY "metric_definitions_tenant_read" ON metric_definitions
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "metric_definitions_tenant_write" ON metric_definitions;
    CREATE POLICY "metric_definitions_tenant_write" ON metric_definitions
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Reporting snapshots
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reporting_snapshots' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE reporting_snapshots ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "reporting_snapshots_tenant_read" ON reporting_snapshots;
    CREATE POLICY "reporting_snapshots_tenant_read" ON reporting_snapshots
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "reporting_snapshots_tenant_write" ON reporting_snapshots;
    CREATE POLICY "reporting_snapshots_tenant_write" ON reporting_snapshots
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Metric history
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_history' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE metric_history ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "metric_history_tenant_read" ON metric_history;
    CREATE POLICY "metric_history_tenant_read" ON metric_history
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "metric_history_tenant_write" ON metric_history;
    CREATE POLICY "metric_history_tenant_write" ON metric_history
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Alert rules
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_rules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "alert_rules_tenant_read" ON alert_rules;
    CREATE POLICY "alert_rules_tenant_read" ON alert_rules
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "alert_rules_tenant_write" ON alert_rules;
    CREATE POLICY "alert_rules_tenant_write" ON alert_rules
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Alert instances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_instances' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE alert_instances ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "alert_instances_tenant_read" ON alert_instances;
    CREATE POLICY "alert_instances_tenant_read" ON alert_instances
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "alert_instances_tenant_write" ON alert_instances;
    CREATE POLICY "alert_instances_tenant_write" ON alert_instances
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Dashboard views
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dashboard_views' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE dashboard_views ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "dashboard_views_tenant_read" ON dashboard_views;
    CREATE POLICY "dashboard_views_tenant_read" ON dashboard_views
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "dashboard_views_tenant_write" ON dashboard_views;
    CREATE POLICY "dashboard_views_tenant_write" ON dashboard_views
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Report schedules
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_schedules' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "report_schedules_tenant_read" ON report_schedules;
    CREATE POLICY "report_schedules_tenant_read" ON report_schedules
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "report_schedules_tenant_write" ON report_schedules;
    CREATE POLICY "report_schedules_tenant_write" ON report_schedules
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Drill down links
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'drill_down_links' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE drill_down_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "drill_down_links_tenant_read" ON drill_down_links;
    CREATE POLICY "drill_down_links_tenant_read" ON drill_down_links
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "drill_down_links_tenant_write" ON drill_down_links;
    CREATE POLICY "drill_down_links_tenant_write" ON drill_down_links
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Forecast entries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forecast_entries' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE forecast_entries ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "forecast_entries_tenant_read" ON forecast_entries;
    CREATE POLICY "forecast_entries_tenant_read" ON forecast_entries
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "forecast_entries_tenant_write" ON forecast_entries;
    CREATE POLICY "forecast_entries_tenant_write" ON forecast_entries
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- GUEST PORTAL TABLES
-- ============================================================================

DO $$
BEGIN
  -- Guest sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_sessions' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "guest_sessions_tenant_read" ON guest_sessions;
    CREATE POLICY "guest_sessions_tenant_read" ON guest_sessions
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "guest_sessions_tenant_write" ON guest_sessions;
    CREATE POLICY "guest_sessions_tenant_write" ON guest_sessions
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Guest notifications
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_notifications' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_notifications ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "guest_notifications_tenant_read" ON guest_notifications;
    CREATE POLICY "guest_notifications_tenant_read" ON guest_notifications
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "guest_notifications_tenant_write" ON guest_notifications;
    CREATE POLICY "guest_notifications_tenant_write" ON guest_notifications
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Digital keys
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'digital_keys' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE digital_keys ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "digital_keys_tenant_read" ON digital_keys;
    CREATE POLICY "digital_keys_tenant_read" ON digital_keys
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "digital_keys_tenant_write" ON digital_keys;
    CREATE POLICY "digital_keys_tenant_write" ON digital_keys
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Mobile check-ins
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mobile_check_ins' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE mobile_check_ins ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "mobile_check_ins_tenant_read" ON mobile_check_ins;
    CREATE POLICY "mobile_check_ins_tenant_read" ON mobile_check_ins
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "mobile_check_ins_tenant_write" ON mobile_check_ins;
    CREATE POLICY "mobile_check_ins_tenant_write" ON mobile_check_ins
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- Guest FAQs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_faqs' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE guest_faqs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "guest_faqs_tenant_read" ON guest_faqs;
    CREATE POLICY "guest_faqs_tenant_read" ON guest_faqs
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "guest_faqs_tenant_write" ON guest_faqs;
    CREATE POLICY "guest_faqs_tenant_write" ON guest_faqs
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- UNIFIED INVENTORY TABLES
-- ============================================================================

DO $$
BEGIN
  -- uinv_stock_balances
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_balances' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_stock_balances ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "uinv_stock_balances_tenant_read" ON uinv_stock_balances;
    CREATE POLICY "uinv_stock_balances_tenant_read" ON uinv_stock_balances
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "uinv_stock_balances_tenant_write" ON uinv_stock_balances;
    CREATE POLICY "uinv_stock_balances_tenant_write" ON uinv_stock_balances
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- uinv_stock_ledger
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_ledger' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_stock_ledger ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "uinv_stock_ledger_tenant_read" ON uinv_stock_ledger;
    CREATE POLICY "uinv_stock_ledger_tenant_read" ON uinv_stock_ledger
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "uinv_stock_ledger_tenant_write" ON uinv_stock_ledger;
    CREATE POLICY "uinv_stock_ledger_tenant_write" ON uinv_stock_ledger
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- uinv_items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_items' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "uinv_items_tenant_read" ON uinv_items;
    CREATE POLICY "uinv_items_tenant_read" ON uinv_items
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "uinv_items_tenant_write" ON uinv_items;
    CREATE POLICY "uinv_items_tenant_write" ON uinv_items
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;

  -- uinv_stores
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stores' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE uinv_stores ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "uinv_stores_tenant_read" ON uinv_stores;
    CREATE POLICY "uinv_stores_tenant_read" ON uinv_stores
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "uinv_stores_tenant_write" ON uinv_stores;
    CREATE POLICY "uinv_stores_tenant_write" ON uinv_stores
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- AIRPORT SHUTTLE
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'airport_shuttle_requests' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE airport_shuttle_requests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "airport_shuttle_requests_tenant_read" ON airport_shuttle_requests;
    CREATE POLICY "airport_shuttle_requests_tenant_read" ON airport_shuttle_requests
      FOR SELECT TO authenticated USING (check_tenant_access(tenant_id));
    DROP POLICY IF EXISTS "airport_shuttle_requests_tenant_write" ON airport_shuttle_requests;
    CREATE POLICY "airport_shuttle_requests_tenant_write" ON airport_shuttle_requests
      FOR ALL TO authenticated USING (check_tenant_access(tenant_id)) WITH CHECK (check_tenant_access(tenant_id));
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=== Multi-Tenant RLS Policies Applied ===';
  RAISE NOTICE 'RLS policies have been applied to all tenant-scoped tables.';
  RAISE NOTICE 'Tenant isolation is now enforced at the database level.';
  RAISE NOTICE 'Super-admins can bypass tenant restrictions for cross-tenant operations.';
END $$;

-- ============================================================================
-- END OF MIGRATION 703
-- ============================================================================
