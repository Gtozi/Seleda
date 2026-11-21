-- Check if super admin user exists and verify setup
-- Run this in Supabase SQL Editor

-- Check if user exists
SELECT 
  u.id, 
  u.name, 
  u.email, 
  u.role, 
  u.status,
  u.password_hash IS NOT NULL as has_password,
  u.force_password_change,
  t.id as tenant_id, 
  t.name as tenant_name, 
  t.code as tenant_code,
  tua.is_default, 
  tua.is_super_admin
FROM system_users u
LEFT JOIN tenant_user_assignments tua ON u.id = tua.user_id
LEFT JOIN tenants t ON tua.tenant_id = t.id
WHERE u.email = 'superadmin@hotel.com';

-- If no results, the user doesn't exist. Run create_super_admin_final.sql first.
