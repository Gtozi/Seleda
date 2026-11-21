-- Create Super Admin Account with Proper Password Hash
-- Run this in Supabase SQL Editor

-- Step 1: Generate bcrypt hash (you'll need to run this separately)
-- The hash below is for password: SuperAdmin123!
-- Generated using bcryptjs with salt rounds 10
-- To generate your own: node generate_super_admin_password.js

-- Step 2: Ensure a default tenant exists
DO $$
DECLARE
  v_default_tenant_id UUID;
BEGIN
  SELECT id INTO v_default_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;
  
  IF v_default_tenant_id IS NULL THEN
    INSERT INTO tenants (name, code, status, settings)
    VALUES ('Default Tenant', 'default-tenant', 'Active', '{}'::jsonb)
    RETURNING id INTO v_default_tenant_id;
  END IF;
END $$;

-- Step 3: Create super-admin user
-- Replace the password_hash below with the hash from your Node.js script
DO $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_password_hash TEXT := '$2a$10$YourGeneratedBcryptHashHere'; -- REPLACE THIS
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;
  
  SELECT id INTO v_user_id FROM system_users WHERE email = 'superadmin@hotel.com' LIMIT 1;
  
  IF v_user_id IS NULL THEN
    INSERT INTO system_users (
      id, name, email, username, password_hash, role, status, 
      avatar_initials, force_password_change, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(),
      'Super Administrator',
      'superadmin@hotel.com',
      'superadmin',
      v_password_hash,
      'executive',
      'Active',
      'SA',
      false,  -- Don't force password change since we set it
      now(),
      now()
    )
    RETURNING id INTO v_user_id;
  ELSE
    -- Update existing user with new password hash
    UPDATE system_users 
    SET password_hash = v_password_hash,
        force_password_change = false,
        updated_at = now()
    WHERE id = v_user_id;
  END IF;
  
  -- Step 4: Create tenant assignment with super-admin privileges
  INSERT INTO tenant_user_assignments (
    user_id, tenant_id, is_default, is_super_admin, created_at
  )
  VALUES (v_user_id, v_tenant_id, true, true, now())
  ON CONFLICT (user_id, tenant_id) 
  DO UPDATE SET is_default = true, is_super_admin = true;
END $$;

-- Step 5: Verify the setup
SELECT 
  u.id as user_id, u.name, u.email, u.role, u.status,
  t.id as tenant_id, t.name as tenant_name, t.code as tenant_code,
  tua.is_default, tua.is_super_admin
FROM system_users u
JOIN tenant_user_assignments tua ON u.id = tua.user_id
JOIN tenants t ON tua.tenant_id = t.id
WHERE u.email = 'superadmin@hotel.com';
