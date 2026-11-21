-- Create Super Admin Account
-- Run this in Supabase SQL Editor to create a super-admin user
-- Note: Password will need to be set via the application's change-password endpoint

-- Step 1: Ensure a default tenant exists
DO $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  -- Check if default tenant exists
  SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;
  
  -- If not, create one
  IF v_default_tenant_id IS NULL THEN
    INSERT INTO tenants (name, code, status, settings)
    VALUES ('Default Tenant', 'default-tenant', 'Active', '{}'::jsonb)
    RETURNING id INTO v_default_tenant_id;
  END IF;
END $$;

-- Step 2: Create super-admin user (if not exists)
-- This creates the user with a placeholder password hash
-- You'll need to set the actual password via the change-password endpoint
DO $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
BEGIN
  -- Get or create default tenant
  SELECT id INTO v_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;
  
  -- Check if user already exists
  SELECT id INTO v_user_id FROM system_users WHERE email = 'superadmin@hotel.com' LIMIT 1;
  
  -- If user doesn't exist, create it
  IF v_user_id IS NULL THEN
    INSERT INTO system_users (
      id,
      name,
      email,
      username,
      password_hash,
      role,
      status,
      avatar_initials,
      force_password_change,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      'Super Administrator',
      'superadmin@hotel.com',
      'superadmin',
      'PLACEHOLDER_HASH_WILL_BE_SET_VIA_APP',  -- Placeholder - will be set via app
      'executive',
      'Active',
      'SA',
      true,  -- Force password change on first login
      now(),
      now()
    )
    RETURNING id INTO v_user_id;
  END IF;
  
  -- Step 3: Create tenant assignment with super-admin privileges
  INSERT INTO tenant_user_assignments (
    user_id,
    tenant_id,
    is_default,
    is_super_admin,
    created_at
  )
  VALUES (
    v_user_id,
    v_tenant_id,
    true,  -- Default tenant
    true,  -- Super admin
    now()
  )
  ON CONFLICT (user_id, tenant_id) 
  DO UPDATE SET 
    is_default = true,
    is_super_admin = true;
END $$;

-- Step 4: Verify the setup
SELECT 
  u.id as user_id,
  u.name,
  u.email,
  u.role,
  u.status,
  u.force_password_change,
  t.id as tenant_id,
  t.name as tenant_name,
  t.code as tenant_code,
  tua.is_default,
  tua.is_super_admin
FROM system_users u
JOIN tenant_user_assignments tua ON u.id = tua.user_id
JOIN tenants t ON tua.tenant_id = t.id
WHERE u.email = 'superadmin@hotel.com';
