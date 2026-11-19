-- ============================================================
-- Migration 656: POS permission codes + role grants
-- ============================================================
-- src/server/routes/pos.routes.ts guards endpoints with
--   requirePermission('pos:transaction')
--   requirePermission('pos:sync:resolve')
--   requirePermission('pos:hardware:manage')
--   requirePermission('pos_settings:read')
--   requirePermission('pos_settings:update')
-- but these codes were never seeded into `permissions`, so every
-- non-superuser received 403 on core POS writes (the same failure
-- mode migration 188 fixed for fb:*). Seed them and grant to the
-- operational roles that need them.

INSERT INTO permissions (id, code, module, description) VALUES
  ('perm_pos_transaction',     'pos:transaction',      'pos', 'Create and view POS transactions'),
  ('perm_pos_sync_resolve',    'pos:sync:resolve',     'pos', 'Resolve offline POS sync conflicts'),
  ('perm_pos_hardware_manage', 'pos:hardware:manage',  'pos', 'Register and manage POS printers and payment terminals'),
  ('perm_pos_settings_read',   'pos_settings:read',    'pos', 'Read POS settings (outlets, tax profiles, GL mappings, terminals, shifts)'),
  ('perm_pos_settings_update', 'pos_settings:update',  'pos', 'Update POS settings (outlets, tax profiles, GL mappings, terminals, shifts, menus)')
ON CONFLICT (id) DO UPDATE SET
  code = excluded.code,
  module = excluded.module,
  description = excluded.description;

-- Grant POS permissions to operational roles.
-- Matched by role name (defensive — role ids vary across environments)
-- plus every superuser role for completeness.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.code IN (
    'pos:transaction',
    'pos:sync:resolve',
    'pos:hardware:manage',
    'pos_settings:read',
    'pos_settings:update'
  )
  AND (
    r.is_superuser
    OR r.id IN ('role_admin', 'role_executive', 'role_fb', 'role_frontoffice', 'role_gm', 'role_fnb')
    OR lower(r.name) IN (
      'admin', 'executive', 'general_manager', 'gm', 'owner',
      'fb', 'fb_manager', 'food_beverage', 'fnb', 'fn_manager',
      'frontoffice', 'fo_manager', 'front_office'
    )
  )
ON CONFLICT DO NOTHING;
