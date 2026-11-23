-- Create Super Admin Account
-- Run this in Supabase SQL Editor

-- Step 1: Ensure a default tenant exists
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

-- Step 2: Create super-admin user with your password hash
DO $$
DECLARE
  v_user_id TEXT;
  v_tenant_id UUID;
  v_password_hash TEXT := '$2b$10$ANPnBrTwDLhbTX0gd85y7eSeAxLw4jynevEvss13Vy2mTr4jY9OOK';
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE code = 'default-tenant' LIMIT 1;
  
  SELECT id INTO v_user_id FROM system_users WHERE email = 'superadmin@hotel.com' LIMIT 1;
  
  IF v_user_id IS NULL THEN
    INSERT INTO system_users (
      id, name, email, username, password_hash, role, status, 
      avatar_initials, force_password_change, created_at, updated_at
    )
    VALUES (
      gen_random_uuid()::text,
      'Super Administrator',
      'superadmin@hotel.com',
      'superadmin',
      v_password_hash,
      'executive',
      'Active',
      'SA',
      false,
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
  
  -- Step 3: Create tenant assignment with super-admin privileges
  INSERT INTO tenant_user_assignments (
    user_id, tenant_id, is_default, is_super_admin, created_at
  )
  VALUES (v_user_id, v_tenant_id, true, true, now())
  ON CONFLICT (user_id, tenant_id) 
  DO UPDATE SET is_default = true, is_super_admin = true;
END $$;

-- Step 4: Verify the setup
SELECT 
  u.id as user_id, 
  u.name, 
  u.email, 
  u.role, 
  u.status,
  t.id as tenant_id, 
  t.name as tenant_name, 
  t.code as tenant_code,
  tua.is_default, 
  tua.is_super_admin
FROM system_users u
JOIN tenant_user_assignments tua ON u.id = tua.user_id
JOIN tenants t ON tua.tenant_id = t.id
WHERE u.email = 'superadmin@hotel.com';
