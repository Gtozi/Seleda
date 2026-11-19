-- ============================================================
-- 647_exec_permissions_and_overrides.sql
-- Executive portal authorization + status overrides
-- ============================================================
-- 1. exec:* permission codes used by executive.routes.ts.
--    Previously these codes were referenced by requirePermission()
--    but did not exist in the permissions catalog, so they could
--    never be granted to a non-superuser role.
-- 2. exec_item_overrides — executive-level status dispositions for
--    aggregated alerts (/alerts-exceptions) and AI recommendations
--    (/ai-decision-support). Those endpoints merge rows from ~27
--    source tables; writing status back to each source isn't feasible,
--    so overrides are stored here and applied at read time.
-- ============================================================

-- Only codes actually enforced by executive.routes.ts are seeded.
INSERT INTO permissions (id, code, module, description) VALUES
  ('perm_exec_view',                 'exec:view',                    'executive', 'View Executive BI portal endpoints (all GET /api/executive/*)'),
  ('perm_exec_reports_run',          'exec:reports:run',             'executive', 'Run reports from the executive Reports Center'),
  ('perm_exec_reports_manage',       'exec:reports:manage',          'executive', 'Edit report frequency/format/status in Reports Center'),
  ('perm_exec_alerts_update',        'exec:alerts:update',           'executive', 'Acknowledge / resolve aggregated executive alerts'),
  ('perm_exec_recommendations_update','exec:recommendations:update', 'executive', 'Change AI recommendation status (start/implement/dismiss)'),
  ('perm_exec_strategic_manage',     'exec:strategic:manage',        'executive', 'Create/edit/delete strategic planning items'),
  ('perm_exec_config_manage',        'exec:config:manage',           'executive', 'Edit executive KPI targets, alert rules and health checks')
ON CONFLICT DO NOTHING;

-- Grant exec:* permissions to the executive and admin roles when present.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.id IN ('role_executive', 'role_admin')
  AND p.code LIKE 'exec:%'
ON CONFLICT DO NOTHING;

-- ── Executive status overrides ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exec_item_overrides (
  id          TEXT PRIMARY KEY DEFAULT 'ovr_' || gen_random_uuid()::text,
  item_kind   TEXT NOT NULL CHECK (item_kind IN ('alert', 'recommendation')),
  item_id     TEXT NOT NULL,          -- composite id emitted by the API (e.g. 'ops-123', 'rms-abc')
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('acknowledged','resolved','in_progress','implemented','dismissed')),
  note        TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_kind, item_id)
);

CREATE INDEX IF NOT EXISTS idx_exec_item_overrides_kind ON public.exec_item_overrides(item_kind);

ALTER TABLE public.exec_item_overrides ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exec_item_overrides TO authenticated;

DROP POLICY IF EXISTS "authenticated can CRUD exec_item_overrides" ON public.exec_item_overrides;
CREATE POLICY "authenticated can CRUD exec_item_overrides" ON public.exec_item_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
