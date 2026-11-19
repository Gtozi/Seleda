-- ============================================================================
-- 624_security_module_registry.sql — Register Security department modules
-- ============================================================================
-- The admin module-access UI (PermissionChecklist / ModuleAccessSelector) is
-- driven by the `public.modules` table via the get_module_registry() RPC
-- (migration 187). The Security portal's 25 tabs (sec_* modIds from
-- src/config/departmentTabs.ts) were never registered, so roles with
-- department='security' fell back to GENERIC_MODULE_ACCESS.
--
-- 1. Seed the 25 sec_* module rows (department='security').
-- 2. Recreate get_module_registry() with 'security' added to the hardcoded
--    departments VALUES list.
-- ============================================================================

-- ── 1. Seed Security modules ───────────────────────────────────────────────

INSERT INTO public.modules (id, department, label, icon, description, sort_order) VALUES
  ('sec_dashboard',           'security', 'Dashboard',                  '📊', 'Security executive dashboard',            1),
  ('sec_soc',                 'security', 'Security Operations Center', '🛡️', 'Live SOC board: incidents, patrols, CCTV', 2),
  ('sec_incidents',           'security', 'Incident Management',        '⚠️', 'Incident lifecycle management',           3),
  ('sec_investigations',      'security', 'Investigations',             '🔍', 'Case investigations, witnesses, evidence',4),
  ('sec_visitors',            'security', 'Visitor Management',         '👥', 'Visitor registration and blacklist',      5),
  ('sec_access',              'security', 'Access Control',             '🔒', 'Access grants and schedules',             6),
  ('sec_keys',                'security', 'Key & Keycard Management',   '🔑', 'Physical keys and keycard inventory',     7),
  ('sec_cctv',                'security', 'CCTV Management',            '📹', 'Camera registry and events',              8),
  ('sec_patrols',             'security', 'Patrol Management',          '👣', 'Patrol routes and checkpoint scans',      9),
  ('sec_lostfound',           'security', 'Lost & Found Oversight',     '🔍', 'Lost & found cases and custody',         10),
  ('sec_emergency',           'security', 'Emergency Management',       '🚨', 'Emergency notifications and responses',  11),
  ('sec_firesafety',          'security', 'Fire & Life Safety',         '🔥', 'Fire equipment and activities',          12),
  ('sec_risk',                'security', 'Risk Management',            '⚠️', 'Risk register and mitigation actions',   13),
  ('sec_businesscontinuity',  'security', 'Business Continuity',        '🛟', 'BCP plans and exercises',                14),
  ('sec_crisis',              'security', 'Crisis Management',          '⚠️', 'Crisis events and updates',              15),
  ('sec_healthsafety',        'security', 'Health & Safety',            '❤️', 'Safety inspections and hazards',         16),
  ('sec_compliance',          'security', 'Compliance Management',      '✅', 'Compliance items and audits',            17),
  ('sec_assetprotection',     'security', 'Asset Protection',           '🛡️', 'High-value asset register and checks',  18),
  ('sec_fraudprevention',     'security', 'Fraud Prevention',           '🕵️', 'Fraud cases and alerts',                 19),
  ('sec_evidence',            'security', 'Evidence Management',        '🗄️', 'Evidence register and chain of custody',20),
  ('sec_communication',       'security', 'Communication Center',       '💬', 'Security messages and acknowledgements', 21),
  ('sec_staff',               'security', 'Staff Management',           '👥', 'Security roster, shifts, training',      22),
  ('sec_requisitions',        'security', 'Requisitions',               '📋', 'Department supply requisitions',         23),
  ('sec_reports',             'security', 'Reports',                    '📈', 'Security reports registry',              24),
  ('sec_configuration',       'security', 'Configuration',              '⚙️', 'Zones, patrol routes, incident config',  25)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Recreate get_module_registry() with 'security' in departments ────────

CREATE OR REPLACE FUNCTION public.get_module_registry()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'modules', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', m.id, 'department', m.department, 'label', m.label,
          'icon', m.icon, 'description', m.description,
          'is_active', m.is_active, 'sort_order', m.sort_order
        )
        ORDER BY m.department, m.sort_order
      )
      FROM public.modules m
      WHERE m.is_active = true
    ),
    'permissionCategories', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pc.id, 'label', pc.label, 'icon', pc.icon,
          'actions', pc.actions, 'sort_order', pc.sort_order
        )
        ORDER BY pc.sort_order
      )
      FROM public.permission_categories pc
    ),
    'departmentPermissionCategories', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'department', dpc.department, 'category_id', dpc.category_id,
          'sort_order', dpc.sort_order
        )
        ORDER BY dpc.department, dpc.sort_order
      )
      FROM public.department_permission_categories dpc
    ),
    'departments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d.id, 'label', d.label, 'icon', d.icon, 'color', d.color
        )
      )
      FROM (VALUES
        ('executive', 'Executive', '👑', 'gold'),
        ('fnb', 'Food & Beverage', '🍽️', 'amber'),
        ('frontoffice', 'Front Office', '🏨', 'indigo'),
        ('housekeeping', 'Housekeeping', '🧹', 'sky'),
        ('engineering', 'Engineering', '🔧', 'orange'),
        ('finance', 'Finance', '💰', 'emerald'),
        ('hr', 'Human Resources', '👥', 'violet'),
        ('inventory', 'Inventory', '📦', 'blue'),
        ('procurement', 'Procurement', '🛒', 'teal'),
        ('sales', 'Sales & Marketing', '📈', 'rose'),
        ('operations', 'Operations', '🔄', 'slate'),
        ('security', 'Security', '🛡️', 'red')
      ) AS d(id, label, icon, color)
    )
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.get_module_registry() TO authenticated;

-- END: 624_security_module_registry.sql
