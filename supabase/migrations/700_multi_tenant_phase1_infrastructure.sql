-- Migration 700: Multi-Tenant Phase 1 - Tenant Infrastructure
-- This migration creates the core tenant infrastructure:
-- 1. tenants table (replaces/supplements organizations table)
-- 2. tenant_user_assignments junction table
-- 3. active_tenant_id column on user_sessions
-- 4. Required indexes

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. TENANTS TABLE
-- ============================================================================
-- This table represents the top-level tenant in the multi-tenant architecture.
-- Each tenant can have multiple properties and users.
-- We keep the existing organizations table for backward compatibility,
-- but create a new tenants table that will be the source of truth for
-- multi-tenant isolation.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  code TEXT UNIQUE NOT NULL,
  tax_id TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  phone TEXT,
  email TEXT,
  currency TEXT DEFAULT 'ETB',
  fiscal_year_start DATE,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Suspended')),
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for tenants
CREATE INDEX IF NOT EXISTS idx_tenants_code ON tenants(code);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(name);

-- Add comment
COMMENT ON TABLE tenants IS 'Multi-tenant tenant table - each tenant represents an independent hotel organization with complete data isolation';

-- ============================================================================
-- 2. TENANT USER ASSIGNMENTS TABLE
-- ============================================================================
-- Junction table that links users to tenants.
-- A user can belong to multiple tenants (for super-admins).
-- is_default marks the tenant the user should start in.
-- is_super_admin grants cross-tenant access.

CREATE TABLE IF NOT EXISTS tenant_user_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Create indexes for tenant_user_assignments
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_user ON tenant_user_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_tenant ON tenant_user_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_default ON tenant_user_assignments(user_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_tenant_assignments_super_admin ON tenant_user_assignments(user_id) WHERE is_super_admin = true;

-- Add comment
COMMENT ON TABLE tenant_user_assignments IS 'Junction table linking system_users to tenants. Supports multi-tenant user assignments with super-admin capabilities.';

-- ============================================================================
-- 3. USER SESSIONS ENHANCEMENT
-- ============================================================================
-- Add active_tenant_id to track which tenant the user is currently accessing.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS active_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant ON user_sessions(active_tenant_id);

-- Add comment
COMMENT ON COLUMN user_sessions.active_tenant_id IS 'The currently active tenant for this session. Used for RLS policies to enforce tenant isolation.';

-- ============================================================================
-- 4. ENABLE RLS ON TENANT TABLES
-- ============================================================================
-- Enable RLS on tenant infrastructure tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_user_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS POLICIES FOR TENANT TABLES
-- ============================================================================
-- These policies are more permissive since tenant management is a system-level
-- operation. The actual data isolation happens on the data tables (Phase 4).

-- Tenants table: authenticated users can read all tenants (for super-admin selection)
DROP POLICY IF EXISTS "tenants_read_authenticated" ON tenants;
CREATE POLICY "tenants_read_authenticated" ON tenants
  FOR SELECT TO authenticated
  USING (true);

-- Tenants table: only super-admins can create/update tenants
DROP POLICY IF EXISTS "tenants_write_superuser" ON tenants;
CREATE POLICY "tenants_write_superuser" ON tenants
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_user_assignments tua
      WHERE tua.user_id = (
        SELECT user_id FROM user_sessions
        WHERE token_hash = current_setting('app.session_token_hash', true)
        LIMIT 1
      )
      AND tua.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_user_assignments tua
      WHERE tua.user_id = (
        SELECT user_id FROM user_sessions
        WHERE token_hash = current_setting('app.session_token_hash', true)
        LIMIT 1
      )
      AND tua.is_super_admin = true
    )
  );

-- Tenant user assignments: users can read their own assignments
DROP POLICY IF EXISTS "tenant_assignments_read_own" ON tenant_user_assignments;
CREATE POLICY "tenant_assignments_read_own" ON tenant_user_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = (
      SELECT user_id FROM user_sessions
      WHERE token_hash = current_setting('app.session_token_hash', true)
      LIMIT 1
    )
  );

-- Tenant user assignments: super-admins can read all assignments
DROP POLICY IF EXISTS "tenant_assignments_read_superuser" ON tenant_user_assignments;
CREATE POLICY "tenant_assignments_read_superuser" ON tenant_user_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_user_assignments tua
      WHERE tua.user_id = (
        SELECT user_id FROM user_sessions
        WHERE token_hash = current_setting('app.session_token_hash', true)
        LIMIT 1
      )
      AND tua.is_super_admin = true
    )
  );

-- Tenant user assignments: only super-admins can manage assignments
DROP POLICY IF EXISTS "tenant_assignments_write_superuser" ON tenant_user_assignments;
CREATE POLICY "tenant_assignments_write_superuser" ON tenant_user_assignments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_user_assignments tua
      WHERE tua.user_id = (
        SELECT user_id FROM user_sessions
        WHERE token_hash = current_setting('app.session_token_hash', true)
        LIMIT 1
      )
      AND tua.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_user_assignments tua
      WHERE tua.user_id = (
        SELECT user_id FROM user_sessions
        WHERE token_hash = current_setting('app.session_token_hash', true)
        LIMIT 1
      )
      AND tua.is_super_admin = true
    )
  );

-- ============================================================================
-- 6. FUNCTION TO GET CURRENT TENANT ID FROM SESSION
-- ============================================================================
-- This helper function is used by RLS policies to determine the current tenant.

CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT active_tenant_id INTO v_tenant_id
  FROM user_sessions
  WHERE token_hash = current_setting('app.session_token_hash', true)
  LIMIT 1;

  RETURN v_tenant_id;
END;
$$;

-- Add comment
COMMENT ON FUNCTION get_current_tenant_id() IS 'Helper function to get the current tenant ID from the active session. Used by RLS policies.';

-- ============================================================================
-- 7. FUNCTION TO CHECK IF USER IS SUPER ADMIN
-- ============================================================================
-- This helper function checks if the current user has super-admin privileges.

CREATE OR REPLACE FUNCTION is_current_user_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_super_admin BOOLEAN := false;
BEGIN
  SELECT COALESCE(bool_or(is_super_admin), false) INTO v_is_super_admin
  FROM tenant_user_assignments
  WHERE user_id = (
    SELECT user_id FROM user_sessions
    WHERE token_hash = current_setting('app.session_token_hash', true)
    LIMIT 1
  );

  RETURN v_is_super_admin;
END;
$$;

-- Add comment
COMMENT ON FUNCTION is_current_user_super_admin() IS 'Helper function to check if the current user has super-admin privileges across tenants.';

-- ============================================================================
-- 8. FUNCTION TO GET USER'S DEFAULT TENANT
-- ============================================================================
-- This helper function returns the user's default tenant ID.

CREATE OR REPLACE FUNCTION get_user_default_tenant(p_user_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM tenant_user_assignments
  WHERE user_id = p_user_id AND is_default = true
  LIMIT 1;

  -- If no default, return the first assigned tenant
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM tenant_user_assignments
    WHERE user_id = p_user_id
    LIMIT 1;
  END IF;

  RETURN v_tenant_id;
END;
$$;

-- Add comment
COMMENT ON FUNCTION get_user_default_tenant(p_user_id TEXT) IS 'Helper function to get a user''s default tenant ID. Returns the first assigned tenant if no default is set.';

-- ============================================================================
-- END OF MIGRATION 700
-- ============================================================================
