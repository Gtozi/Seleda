-- ============================================================
-- 644_ops_modules_registry.sql
-- Operations portal module registry seeds
-- ============================================================
-- The 23 Operations portal tabs (modIds `ops_*`, see
-- src/config/departmentTabs.ts) were never seeded into
-- public.modules, so the Admin role/permission editor could not
-- grant or revoke them per-role. This registers them under the
-- 'operations' department (seeded in 187_dynamic_modules_permissions.sql).
-- ============================================================

INSERT INTO public.modules (id, department, label, icon, description, sort_order) VALUES
  ('ops_executive_dashboard',     'operations', 'Executive Dashboard',        '📊', 'Operations KPI dashboard with live cross-portal alerts', 1),
  ('ops_command_center',          'operations', 'Operations Command Center',  '🎛️', 'Live department status grid and alert feed', 2),
  ('ops_daily_briefing',          'operations', 'Daily Briefing',             '📄', 'Aggregated daily briefing with saved snapshots', 3),
  ('ops_morning_meeting',         'operations', 'Morning Meeting',            '👥', 'Morning meeting agenda and action items', 4),
  ('ops_approvals',               'operations', 'Manager Approvals',          '✅', 'Unified approval inbox across departments', 5),
  ('ops_cross_department_tasks',  'operations', 'Cross-Department Tasks',     '🔀', 'Cross-department task coordination center', 6),
  ('ops_duty_manager',            'operations', 'Duty Manager Workspace',     '💼', 'Shift logbook, walkthroughs and handovers', 7),
  ('ops_calendar',                'operations', 'Operational Calendar',       '📅', 'Unified operational calendar', 8),
  ('ops_vip_management',          'operations', 'VIP Guest Management',       '⭐', 'VIP roster, profiles and service tracking', 9),
  ('ops_guest_recovery',          'operations', 'Guest Recovery',             '💛', 'Service recovery case management', 10),
  ('ops_service_quality',         'operations', 'Service Quality',            '🏅', 'Quality metrics and audit scheduling', 11),
  ('ops_room_operations',         'operations', 'Room Operations',            '🛏️', 'Room board with HK/WO enrichment', 12),
  ('ops_occupancy_forecast',      'operations', 'Occupancy & Forecast',       '📈', 'Occupancy forecast monitor', 13),
  ('ops_event_coordination',      'operations', 'Event & Group Coordination', '🎟️', 'Event and group coordination board', 14),
  ('ops_emergency',               'operations', 'Emergency Coordination',     '🔥', 'Emergency coordination shared with Security SOC', 15),
  ('ops_communication',           'operations', 'Communication Center',       '📣', 'Cross-portal messaging and broadcasts', 16),
  ('ops_escalations',             'operations', 'Escalation Center',          '⚠️', 'Escalation lifecycle and auto-detected candidates', 17),
  ('ops_sop_compliance',          'operations', 'SOP & Compliance',           '📋', 'Cross-portal SOP and compliance register', 18),
  ('ops_executive_checklists',    'operations', 'Executive Checklists',       '☑️', 'Recurring executive checklist templates', 19),
  ('ops_flash_reports',           'operations', 'Daily Flash Reports',        '📑', 'Persisted daily flash report snapshots', 20),
  ('ops_requisitions',            'operations', 'Requisitions',               '📝', 'Department inventory requisitions', 21),
  ('ops_reports',                 'operations', 'Reports',                    '🗂️', 'Operations report registry and runs', 22),
  ('ops_configuration',           'operations', 'Configuration',              '⚙️', 'Approval matrix and operations settings', 23)
ON CONFLICT (id) DO NOTHING;

-- Permission categories available to operations roles
INSERT INTO public.department_permission_categories (department, category_id, sort_order) VALUES
  ('operations', 'reports', 1),
  ('operations', 'settings', 2)
ON CONFLICT (department, category_id) DO NOTHING;
