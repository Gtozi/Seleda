-- Migration: Seed hk:inventory:manage permission
--
-- The Housekeeping inventory route handlers (waste, stock-count, consumption,
-- transfers, requisitions, central stock, linen restock) all call
-- requirePermission('hk:inventory:manage'), but this permission code was never
-- registered in the permissions table. Without a registered permission +
-- role grant, the requirePermission middleware always returns false for
-- non-superuser roles, so only full-access roles (admin/gm/owner) could use
-- these endpoints — causing 403 Forbidden for hk_supervisor / hk_manager users.
--
-- This migration registers the permission and grants it to the hk_supervisor
-- and hk_manager roles, matching the pattern established in migrations 304,
-- 306, and 307.

-- ── 1. Register permission ───────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
VALUES
  ('perm-hk-inventory-manage', 'hk:inventory:manage', 'housekeeping',
   'Manage housekeeping inventory: stock counts, waste, consumption, transfers, requisitions, restocks')
ON CONFLICT (id) DO NOTHING;

-- Ensure code exists even if id collided.
INSERT INTO permissions (id, code, module, description)
SELECT 'perm-hk-inventory-manage', 'hk:inventory:manage', 'housekeeping',
       'Manage housekeeping inventory'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hk:inventory:manage');

-- ── 2. Grant to hk_supervisor and hk_manager roles ───────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('hk_supervisor', 'hk_manager')
  AND p.code = 'hk:inventory:manage'
ON CONFLICT DO NOTHING;
