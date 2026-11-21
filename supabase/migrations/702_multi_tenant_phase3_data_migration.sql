-- Migration 702: Multi-Tenant Phase 3 - Data Migration
-- This migration migrates existing data to the new multi-tenant model:
-- 1. Migrate existing organizations to tenants
-- 2. Map properties to their organization's tenant
-- 3. Set tenant_id on all existing data based on property_id
-- 4. Create tenant_user_assignments for all users based on their property_id
-- 5. Set default tenant for each user

-- ============================================================================
-- DISABLE TRIGGERS TEMPORARILY
-- ============================================================================
-- Disable triggers that might reference columns that don't exist or cause issues during bulk updates
SET session_replication_role = 'replica';

-- ============================================================================
-- 1. MIGRATE ORGANIZATIONS TO TENANTS
-- ============================================================================

-- Insert existing organizations as tenants
-- Use the organization's UUID as the tenant UUID to maintain referential integrity
-- Handle both 'name' and 'org_name' column variations, and missing columns
DO $$
BEGIN
  -- Check if 'name' column exists (migration 118 schema)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'name') THEN
    INSERT INTO tenants (id, name, legal_name, code, tax_id, address, city, country, phone, email, currency, fiscal_year_start, status, settings, created_at, updated_at)
    SELECT
      org.id,
      org.name,
      COALESCE(org.legal_name, org.name) as legal_name,
      LOWER(SUBSTRING(org.name, 1, 3) || '-' || SUBSTRING(md5(org.id::text), 1, 8)) as code,
      org.tax_id,
      org.address,
      NULL as city,
      NULL as country,
      org.phone,
      org.email,
      'ETB' as currency,
      org.fiscal_year_start,
      CASE WHEN org.is_active IS FALSE THEN 'Inactive' ELSE 'Active' END as status,
      '{}'::jsonb as settings,
      org.created_at,
      now() as updated_at
    FROM organizations org
    ON CONFLICT (id) DO NOTHING;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'org_name') THEN
    -- migration 139 schema - has different column names
    INSERT INTO tenants (id, name, legal_name, code, tax_id, address, city, country, phone, email, currency, fiscal_year_start, status, settings, created_at, updated_at)
    SELECT
      org.id,
      org.org_name as name,
      org.description as legal_name,  -- Use description as legal_name
      org.org_code as code,  -- Use org_code as tenant code
      NULL as tax_id,  -- migration 139 doesn't have tax_id
      NULL as address,  -- migration 139 has billing_address as JSONB
      NULL as city,
      NULL as country,
      org.contact_phone as phone,
      org.contact_email as email,
      'ETB' as currency,
      NULL as fiscal_year_start,
      CASE WHEN org.is_active IS FALSE THEN 'Inactive' ELSE 'Active' END as status,
      org.metadata as settings,
      org.created_at,
      now() as updated_at
    FROM organizations org
    ON CONFLICT (id) DO NOTHING;
  ELSE
    -- If no organizations exist or have neither column, create a default tenant
    INSERT INTO tenants (name, code, status, settings)
    VALUES ('Default Tenant', 'default-tenant', 'Active', '{}'::jsonb)
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- 2. MAP PROPERTIES TO TENANTS
-- ============================================================================

-- Update properties to link to their organization's tenant
-- This will only work if organizations table exists and properties has org_id column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'org_id') THEN
      UPDATE properties p
      SET tenant_id = org.id
      FROM organizations org
      WHERE p.org_id = org.id
        AND p.tenant_id IS NULL;
    END IF;
  END IF;
END $$;

-- For properties without an org_id, create a default tenant
-- This handles any orphaned properties
DO $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  -- Check if a default tenant already exists
  SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;

  -- If not, create one
  IF v_default_tenant_id IS NULL THEN
    INSERT INTO tenants (name, code, status, settings)
    VALUES ('Default Tenant', 'default-tenant', 'Active', '{}'::jsonb)
    RETURNING id INTO v_default_tenant_id;
  END IF;

  -- Assign orphaned properties to the default tenant
  -- Only if org_id column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'org_id') THEN
    UPDATE properties
    SET tenant_id = v_default_tenant_id
    WHERE org_id IS NULL AND tenant_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. SET TENANT_ID ON CORE TABLES BASED ON PROPERTY_ID
-- ============================================================================

-- Rooms - inherit from their property
UPDATE rooms r
SET tenant_id = p.tenant_id
FROM properties p
WHERE r.property_id = p.id
  AND r.tenant_id IS NULL;

-- Guests - set based on their reservation's property, or first property if no reservations
UPDATE guests g
SET tenant_id = (
  SELECT DISTINCT p.tenant_id
  FROM reservations r
  JOIN properties p ON r.property_id = p.id
  WHERE r.guest_id = g.id
  LIMIT 1
)
WHERE g.tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.guest_id = g.id
  );

-- Guests without reservations - assign to first available tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE guests
    SET tenant_id = v_first_tenant_id
    WHERE tenant_id IS NULL;
  END IF;
END $$;

-- Reservations - inherit from property_id
UPDATE reservations r
SET tenant_id = p.tenant_id
FROM properties p
WHERE r.property_id = p.id
  AND r.tenant_id IS NULL;

-- Reservations without property_id - infer from room
-- Note: reservations may have room_number (text) instead of room_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'room_id') THEN
    UPDATE reservations r
    SET tenant_id = (
      SELECT rm.tenant_id
      FROM rooms rm
      WHERE rm.id = r.room_id
      LIMIT 1
    )
    WHERE r.tenant_id IS NULL
      AND r.property_id IS NULL
      AND r.room_id IS NOT NULL;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'room_number') THEN
    UPDATE reservations r
    SET tenant_id = (
      SELECT rm.tenant_id
      FROM rooms rm
      WHERE rm.number = r.room_number
      LIMIT 1
    )
    WHERE r.tenant_id IS NULL
      AND r.property_id IS NULL
      AND r.room_number IS NOT NULL;
  END IF;
END $$;

-- Reservations still without tenant - assign to first available tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE reservations
    SET tenant_id = v_first_tenant_id
    WHERE tenant_id IS NULL;
  END IF;
END $$;

-- Group bookings - inherit from associated reservations
UPDATE group_bookings gb
SET tenant_id = (
  SELECT DISTINCT r.tenant_id
  FROM reservations r
  WHERE r.group_booking_id = gb.id
  LIMIT 1
)
WHERE gb.tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.group_booking_id = gb.id
  );

-- Corporate accounts - inherit from associated reservations
UPDATE corporate_accounts ca
SET tenant_id = (
  SELECT DISTINCT r.tenant_id
  FROM reservations r
  WHERE r.corporate_account_id = ca.id
  LIMIT 1
)
WHERE ca.tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.corporate_account_id = ca.id
  );

-- ============================================================================
-- 4. SET TENANT_ID ON FOLIO TABLES
-- ============================================================================

-- Folios - inherit from reservation
UPDATE folios f
SET tenant_id = r.tenant_id
FROM reservations r
WHERE f.reservation_id = r.id
  AND f.tenant_id IS NULL;

-- Folio lines - inherit from folio
UPDATE folio_lines fl
SET tenant_id = f.tenant_id
FROM folios f
WHERE fl.folio_id = f.id
  AND fl.tenant_id IS NULL;

-- Folio payments - inherit from folio
UPDATE folio_payments fp
SET tenant_id = f.tenant_id
FROM folios f
WHERE fp.folio_id = f.id
  AND fp.tenant_id IS NULL;

-- Chart of accounts - assign to all tenants for now (or first tenant)
-- COA is often shared across properties within a tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE chart_of_accounts
    SET tenant_id = v_first_tenant_id
    WHERE tenant_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 5. SET TENANT_ID ON RATE MANAGEMENT TABLES
-- ============================================================================

-- Rate plans, seasons, packages, yield policies - assign to first tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE rate_plans SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE seasons SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE packages SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE yield_policies SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 6. SET TENANT_ID ON INVENTORY TABLES
-- ============================================================================

-- Inventory tables - assign to first tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE inventory_stores SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE inventory_items SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE inventory_suppliers SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE inventory_stock_movements SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE inventory_requisitions SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE inventory_grns SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 7. SET TENANT_ID ON GUEST SERVICES TABLES
-- ============================================================================

-- Guest services - inherit from reservation or assign to first tenant
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guest_services' AND column_name = 'reservation_ids') THEN
    UPDATE guest_services gs
    SET tenant_id = (
      SELECT DISTINCT r.tenant_id
      FROM reservations r
      WHERE r.id = ANY(gs.reservation_ids)
      LIMIT 1
    )
    WHERE gs.tenant_id IS NULL
      AND gs.reservation_ids IS NOT NULL
      AND array_length(gs.reservation_ids, 1) > 0;
  END IF;
END $$;

-- Remaining guest services - assign to first tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE guest_services SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE guest_requests SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE guest_feedbacks SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 8. SET TENANT_ID ON GROUP PROFILES & RELATIONSHIPS
-- ============================================================================

-- Group profiles and relationships - assign to first tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE group_profiles SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE guest_group_relationships SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE group_audit_log SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 9. SET TENANT_ID ON SYSTEM & AUDIT TABLES
-- ============================================================================

-- Audit events - assign to first tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    UPDATE audit_events SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    UPDATE custom_roles SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
  END IF;
END $$;

-- Global settings - keep NULL for global settings, but tenant-specific can be set later
-- Global settings with NULL tenant_id are system-wide defaults

-- ============================================================================
-- 10. SET TENANT_ID ON ALL OTHER TABLES
-- ============================================================================

-- This is a bulk update for all remaining tables that have tenant_id
-- Assign them to the first available tenant

DO $$
DECLARE
  v_first_tenant_id UUID;
  v_table_name TEXT;
  v_column_name TEXT;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NULL THEN
    RAISE NOTICE 'No tenants found, skipping bulk tenant_id assignment';
    RETURN;
  END IF;

  -- Housekeeping tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_task_mgmt' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'housekeeping_task_mgmt' AND column_name = 'tenant_id') THEN
      UPDATE housekeeping_task_mgmt SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hk_linen_stock' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hk_linen_stock' AND column_name = 'tenant_id') THEN
      UPDATE hk_linen_stock SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hk_amenity_stock' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hk_amenity_stock' AND column_name = 'tenant_id') THEN
      UPDATE hk_amenity_stock SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_maintenance_issues' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'housekeeping_maintenance_issues' AND column_name = 'tenant_id') THEN
      UPDATE housekeeping_maintenance_issues SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'housekeeping_communication_messages' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'housekeeping_communication_messages' AND column_name = 'tenant_id') THEN
      UPDATE housekeeping_communication_messages SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- F&B tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outlets' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'outlets' AND column_name = 'tenant_id') THEN
      UPDATE outlets SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingredients' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ingredients' AND column_name = 'tenant_id') THEN
      UPDATE ingredients SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'menu_items' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menu_items' AND column_name = 'tenant_id') THEN
      UPDATE menu_items SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recipes' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recipes' AND column_name = 'tenant_id') THEN
      UPDATE recipes SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_locations' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_locations' AND column_name = 'tenant_id') THEN
      UPDATE stock_locations SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_transactions' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_transactions' AND column_name = 'tenant_id') THEN
      UPDATE stock_transactions SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'requisitions' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisitions' AND column_name = 'tenant_id') THEN
      UPDATE requisitions SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'tenant_id') THEN
      UPDATE orders SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'banquet_events' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'banquet_events' AND column_name = 'tenant_id') THEN
      UPDATE banquet_events SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wastage_logs' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wastage_logs' AND column_name = 'tenant_id') THEN
      UPDATE wastage_logs SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_counts' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_counts' AND column_name = 'tenant_id') THEN
      UPDATE stock_counts SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Engineering tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_orders' AND column_name = 'tenant_id') THEN
      UPDATE work_orders SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pm_schedules' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pm_schedules' AND column_name = 'tenant_id') THEN
      UPDATE pm_schedules SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'spare_parts' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'spare_parts' AND column_name = 'tenant_id') THEN
      UPDATE spare_parts SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Operations tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_briefing' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'daily_briefing' AND column_name = 'tenant_id') THEN
      UPDATE daily_briefing SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'action_item' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'action_item' AND column_name = 'tenant_id') THEN
      UPDATE action_item SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'staffing_status' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staffing_status' AND column_name = 'tenant_id') THEN
      UPDATE staffing_status SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'escalation' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'escalation' AND column_name = 'tenant_id') THEN
      UPDATE escalation SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Security tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lost_found' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lost_found' AND column_name = 'tenant_id') THEN
      UPDATE lost_found SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Sales tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_leads' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_leads' AND column_name = 'tenant_id') THEN
      UPDATE sales_leads SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_proposals' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_proposals' AND column_name = 'tenant_id') THEN
      UPDATE sales_proposals SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_contracts' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_contracts' AND column_name = 'tenant_id') THEN
      UPDATE sales_contracts SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_blocks' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'group_blocks' AND column_name = 'tenant_id') THEN
      UPDATE group_blocks SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Finance tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_entries' AND column_name = 'tenant_id') THEN
      UPDATE journal_entries SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_lines' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'journal_lines' AND column_name = 'tenant_id') THEN
      UPDATE journal_lines SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'tenant_id') THEN
      UPDATE vendors SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ap_bills' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ap_bills' AND column_name = 'tenant_id') THEN
      UPDATE ap_bills SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ap_payments' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ap_payments' AND column_name = 'tenant_id') THEN
      UPDATE ap_payments SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_accounts' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'tenant_id') THEN
      UPDATE bank_accounts SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_statement_lines' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_statement_lines' AND column_name = 'tenant_id') THEN
      UPDATE bank_statement_lines SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reconciliation_batches' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reconciliation_batches' AND column_name = 'tenant_id') THEN
      UPDATE reconciliation_batches SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fixed_assets' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fixed_assets' AND column_name = 'tenant_id') THEN
      UPDATE fixed_assets SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'depreciation_schedules' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'depreciation_schedules' AND column_name = 'tenant_id') THEN
      UPDATE depreciation_schedules SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounting_periods' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounting_periods' AND column_name = 'tenant_id') THEN
      UPDATE accounting_periods SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Executive/BI tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_definitions' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'metric_definitions' AND column_name = 'tenant_id') THEN
      UPDATE metric_definitions SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reporting_snapshots' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reporting_snapshots' AND column_name = 'tenant_id') THEN
      UPDATE reporting_snapshots SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_history' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'metric_history' AND column_name = 'tenant_id') THEN
      UPDATE metric_history SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_rules' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alert_rules' AND column_name = 'tenant_id') THEN
      UPDATE alert_rules SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_instances' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alert_instances' AND column_name = 'tenant_id') THEN
      UPDATE alert_instances SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dashboard_views' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboard_views' AND column_name = 'tenant_id') THEN
      UPDATE dashboard_views SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_schedules' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'report_schedules' AND column_name = 'tenant_id') THEN
      UPDATE report_schedules SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'drill_down_links' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'drill_down_links' AND column_name = 'tenant_id') THEN
      UPDATE drill_down_links SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forecast_entries' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forecast_entries' AND column_name = 'tenant_id') THEN
      UPDATE forecast_entries SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Guest portal tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_sessions' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guest_sessions' AND column_name = 'tenant_id') THEN
      UPDATE guest_sessions SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_notifications' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guest_notifications' AND column_name = 'tenant_id') THEN
      UPDATE guest_notifications SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'digital_keys' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'digital_keys' AND column_name = 'tenant_id') THEN
      UPDATE digital_keys SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mobile_check_ins' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mobile_check_ins' AND column_name = 'tenant_id') THEN
      UPDATE mobile_check_ins SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guest_faqs' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'guest_faqs' AND column_name = 'tenant_id') THEN
      UPDATE guest_faqs SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Unified inventory tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_balances' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uinv_stock_balances' AND column_name = 'tenant_id') THEN
      UPDATE uinv_stock_balances SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stock_ledger' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uinv_stock_ledger' AND column_name = 'tenant_id') THEN
      UPDATE uinv_stock_ledger SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_items' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uinv_items' AND column_name = 'tenant_id') THEN
      UPDATE uinv_items SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'uinv_stores' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uinv_stores' AND column_name = 'tenant_id') THEN
      UPDATE uinv_stores SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  -- Airport shuttle
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'airport_shuttle_requests' AND table_type = 'BASE TABLE') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'airport_shuttle_requests' AND column_name = 'tenant_id') THEN
      UPDATE airport_shuttle_requests SET tenant_id = v_first_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END IF;

  RAISE NOTICE 'Bulk tenant_id assignment completed';
END $$;

-- ============================================================================
-- 11. CREATE TENANT USER ASSIGNMENTS
-- ============================================================================

-- Assign users to tenants based on their property_id
-- Users with property_id get assigned to that property's tenant
INSERT INTO tenant_user_assignments (tenant_id, user_id, is_default, is_super_admin)
SELECT DISTINCT
  p.tenant_id,
  su.id as user_id,
  true as is_default,  -- First assignment is default
  CASE WHEN su.role IN ('admin', 'executive', 'general manager', 'gm') THEN true ELSE false END as is_super_admin
FROM system_users su
JOIN properties p ON su.property_id = p.id
WHERE p.tenant_id IS NOT NULL
  AND su.id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Users without property_id - assign to first tenant
DO $$
DECLARE
  v_first_tenant_id UUID;
BEGIN
  SELECT id INTO v_first_tenant_id FROM tenants LIMIT 1;

  IF v_first_tenant_id IS NOT NULL THEN
    INSERT INTO tenant_user_assignments (tenant_id, user_id, is_default, is_super_admin)
    SELECT
      v_first_tenant_id,
      su.id,
      true,
      CASE WHEN su.role IN ('admin', 'executive', 'general manager', 'gm') THEN true ELSE false END
    FROM system_users su
    WHERE su.property_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tenant_user_assignments tua
        WHERE tua.user_id = su.id
      )
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- 12. SET ACTIVE TENANT IN EXISTING SESSIONS
-- ============================================================================

-- Update existing user_sessions to have an active_tenant_id
UPDATE user_sessions us
SET active_tenant_id = (
  SELECT tenant_id
  FROM tenant_user_assignments tua
  WHERE tua.user_id = us.user_id
    AND tua.is_default = true
  LIMIT 1
)
WHERE us.active_tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM tenant_user_assignments tua
    WHERE tua.user_id = us.user_id
  );

-- Sessions where user has no default tenant - use first assignment
UPDATE user_sessions us
SET active_tenant_id = (
  SELECT tenant_id
  FROM tenant_user_assignments tua
  WHERE tua.user_id = us.user_id
  LIMIT 1
)
WHERE us.active_tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM tenant_user_assignments tua
    WHERE tua.user_id = us.user_id
  );

-- ============================================================================
-- 13. MAKE TENANT_ID NOT NULL ON CRITICAL TABLES
-- ============================================================================

-- After migration, make tenant_id NOT NULL on critical tables
-- This enforces tenant isolation at the database level
-- First ensure all records have a tenant_id value

DO $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  -- Get or create default tenant
  SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;
  IF v_default_tenant_id IS NULL THEN
    INSERT INTO tenants (name, code, status, settings)
    VALUES ('Default Tenant', 'default-tenant', 'Active', '{}'::jsonb)
    RETURNING id INTO v_default_tenant_id;
  END IF;

  -- Ensure all properties have a tenant_id
  UPDATE properties SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
  
  -- Ensure all rooms have a tenant_id
  UPDATE rooms SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
  
  -- Ensure all guests have a tenant_id
  UPDATE guests SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
  
  -- Ensure all reservations have a tenant_id
  UPDATE reservations SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
  
  -- Ensure all folios have a tenant_id
  UPDATE folios SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
  
  -- Ensure all folio_lines have a tenant_id
  UPDATE folio_lines SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
  
  -- Ensure all folio_payments have a tenant_id
  UPDATE folio_payments SET tenant_id = v_default_tenant_id WHERE tenant_id IS NULL;
END $$;

-- Now set NOT NULL constraints
ALTER TABLE properties ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rooms ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE guests ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE reservations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE folios ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE folio_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE folio_payments ALTER COLUMN tenant_id SET NOT NULL;

-- ============================================================================
-- 14. RE-ENABLE TRIGGERS
-- ============================================================================

SET session_replication_role = 'origin';

-- ============================================================================
-- 15. VERIFICATION QUERIES
-- ============================================================================

-- Log migration results
DO $$
DECLARE
  v_tenant_count INTEGER;
  v_property_count INTEGER;
  v_user_assignment_count INTEGER;
  v_rooms_without_tenant INTEGER;
  v_reservations_without_tenant INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_tenant_count FROM tenants;
  SELECT COUNT(*) INTO v_property_count FROM properties WHERE tenant_id IS NOT NULL;
  SELECT COUNT(*) INTO v_user_assignment_count FROM tenant_user_assignments;
  SELECT COUNT(*) INTO v_rooms_without_tenant FROM rooms WHERE tenant_id IS NULL;
  SELECT COUNT(*) INTO v_reservations_without_tenant FROM reservations WHERE tenant_id IS NULL;

  RAISE NOTICE '=== Multi-Tenant Data Migration Summary ===';
  RAISE NOTICE 'Tenants created: %', v_tenant_count;
  RAISE NOTICE 'Properties assigned to tenants: %', v_property_count;
  RAISE NOTICE 'User assignments created: %', v_user_assignment_count;
  RAISE NOTICE 'Rooms without tenant: %', v_rooms_without_tenant;
  RAISE NOTICE 'Reservations without tenant: %', v_reservations_without_tenant;

  IF v_rooms_without_tenant > 0 OR v_reservations_without_tenant > 0 THEN
    RAISE WARNING 'Some records still lack tenant_id - manual review may be needed';
  END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION 702
-- ============================================================================
