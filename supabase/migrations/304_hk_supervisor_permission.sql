-- Migration: Add hk:supervisor:manage permission + grant to HK supervisor/manager roles
--
-- The Supervisor Console's 6 mutation endpoints (resolve/create escalation,
-- reassign task, priority override, approve/reject inspection) previously
-- only required authentication — no server-side authorization. The
-- hk_supervisor modId gated the frontend tab via DepartmentRoute, but the
-- backend endpoints were callable by any authenticated user.
--
-- This migration:
--   1. Registers the 'hk:supervisor:manage' permission in the permissions table.
--   2. Grants it to the hk_supervisor and hk_manager roles.
--
-- Full-access roles (executive, general_manager, system_admin, admin, gm,
-- owner) bypass the check via isFullAccessRole() in authHelpers.ts, so no
-- grant is needed for them.

-- ── 1. Register the permission ────────────────────────────────────────
INSERT INTO permissions (id, code, module, description)
VALUES ('perm-hk-supervisor-manage', 'hk:supervisor:manage', 'housekeeping',
        'Manage housekeeping supervisor console actions: resolve/create escalations, reassign tasks, override priority, approve/reject inspections')
ON CONFLICT (id) DO NOTHING;

-- Ensure no duplicate code if the id already exists under a different row.
INSERT INTO permissions (id, code, module, description)
SELECT 'perm-hk-supervisor-manage', 'hk:supervisor:manage', 'housekeeping',
       'Manage housekeeping supervisor console actions'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'hk:supervisor:manage');

-- ── 2. Grant to hk_supervisor and hk_manager roles ────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('hk_supervisor', 'hk_manager')
  AND p.code = 'hk:supervisor:manage'
ON CONFLICT DO NOTHING;
