-- 569 — RMS multi-property isolation for configuration, system status, reports
--
-- Bug: rms_config_settings.setting_key and rms_system_status.component were
-- globally UNIQUE while every seed row carries property_id = NULL. As a
-- result, property-scoped users saw an empty Configuration tab and writes
-- collided across properties; PUT /configuration could only ever update the
-- shared global row. rms_reports is a global registry (PK id TEXT) whose
-- rows must stay visible next to any future per-property rows.
--
-- Fix: uniqueness becomes (property scope, key) where NULL property_id is the
-- global default row. The COALESCE expression makes NULL participate in
-- uniqueness so two global rows with the same key still collide. Property
-- saves create property-scoped override rows (see PUT /configuration in
-- rmsPortal.routes.ts).

-- ============================================================================
-- Defensive dedupe — collapse any duplicate (scope, key) rows before creating
-- the unique indexes. Keeps the newest row per scope (no-op on clean data).
-- ============================================================================
DELETE FROM public.rms_config_settings a
USING public.rms_config_settings b
WHERE a.id <> b.id
  AND a.setting_key = b.setting_key
  AND COALESCE(a.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = COALESCE(b.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND a.created_at < b.created_at;

DELETE FROM public.rms_system_status a
USING public.rms_system_status b
WHERE a.id <> b.id
  AND a.component = b.component
  AND COALESCE(a.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = COALESCE(b.property_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND a.created_at < b.created_at;

-- ============================================================================
-- rms_config_settings — unique per property scope (NULL = global default)
-- ============================================================================
ALTER TABLE public.rms_config_settings
  DROP CONSTRAINT IF EXISTS rms_config_settings_setting_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rms_config_settings_scope_key
  ON public.rms_config_settings
  ((COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid)), setting_key);

CREATE INDEX IF NOT EXISTS idx_rms_config_settings_property
  ON public.rms_config_settings (property_id);

-- ============================================================================
-- rms_system_status — unique per property scope (NULL = global default)
-- ============================================================================
ALTER TABLE public.rms_system_status
  DROP CONSTRAINT IF EXISTS rms_system_status_component_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rms_system_status_scope_component
  ON public.rms_system_status
  ((COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid)), component);

CREATE INDEX IF NOT EXISTS idx_rms_system_status_property
  ON public.rms_system_status (property_id);

-- ============================================================================
-- rms_reports — index the property scope column used by the merged
-- global+property listing queries.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_rms_reports_property
  ON public.rms_reports (property_id);
