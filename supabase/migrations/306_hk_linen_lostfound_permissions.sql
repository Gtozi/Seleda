-- Migration: Seed hk:linen:manage + hk:lostfound:manage permissions
--
-- These permission codes were already referenced in the route handlers
-- (requirePermission('hk:linen:manage'), requirePermission('hk:lostfound:manage'))
-- but were never registered in the permissions table. Without a registered
-- permission + role grant, the requirePermission middleware always returns
-- false for non-superuser roles, so only full-access roles (admin/gm/owner)
-- could use these endpoints.
--
-- This migration registers both permissions and grants them to the
-- hk_supervisor and hk_manager roles, matching the pattern established
-- in migration 304 (hk:supervisor:manage).

-- ── 1. Register permissions ───────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
VALUES
  ('perm-hk-linen-manage', 'hk:linen:manage', 'housekeeping',
   'Manage linen catalog: add/update/delete par-level entries for linen types'),
  ('perm-hk-lostfound-manage', 'hk:lostfound:manage', 'housekeeping',
   'Manage lost & found items: register new items, update status (claim/return/dispose)')
ON CONFLICT (id) DO NOTHING;

-- Ensure codes exist even if ids collided.
INSERT INTO permissions (id, code, module, description)
SELECT 'perm-hk-linen-manage', 'hk:linen:manage', 'housekeeping',
       'Manage linen catalog'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hk:linen:manage');

INSERT INTO permissions (id, code, module, description)
SELECT 'perm-hk-lostfound-manage', 'hk:lostfound:manage', 'housekeeping',
       'Manage lost & found items'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hk:lostfound:manage');

-- ── 2. Grant to hk_supervisor and hk_manager roles ───────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('hk_supervisor', 'hk_manager')
  AND p.code IN ('hk:linen:manage', 'hk:lostfound:manage')
ON CONFLICT DO NOTHING;
