-- ============================================================
-- 707_wipe_business_data_and_tenant_scope.sql
--
-- !!! DESTRUCTIVE MIGRATION — TAKE A SUPABASE BACKUP FIRST !!!
--
-- 1. Preserves platform, auth, RBAC, module registry, global fallback
--    settings ('main'), scheduler definitions/runs, and migration tables.
-- 2. Removes all existing rows from every business table in `public`
--    (plus session/mapping tables user_sessions, guest_sessions,
--    property_users).
-- 3. Adds `tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE`
--    to every business table in `public` that lacks it (covering all
--    business tables from the 706 audit + any remaining public tables).
-- 4. Creates a B-tree index on `(tenant_id)` where one does not exist.
-- 5. Attaches `trg_set_tenant_id` backstop trigger to every business table
--    that has a `property_id uuid` column.
-- 6. Installs `public.purge_tenant_data(uuid)` used by
--    `DELETE /api/admin/tenants/:tenantId`.
--
-- PLATFORM TABLES PRESERVED (schema + data intact):
--   tenants, organizations, system_users, tenant_user_assignments,
--   organization_users, user_roles, user_role_assignments, roles,
--   permissions, role_permissions, permission_categories,
--   permission_versions, department_permission_categories, custom_roles,
--   mfa_secrets, modules, global_settings (id = 'main'),
--   setting_definitions, admin_locales, admin_reports, admin_licenses,
--   admin_identity_providers, api_keys, scheduled_jobs*, job_*,
--   migration / audit bookkeeping tables.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_tenant_id_from_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fill when tenant_id is missing; never overwrite an explicit value.
  IF NEW.tenant_id IS NULL AND NEW.property_id IS NOT NULL THEN
    SELECT p.tenant_id INTO NEW.tenant_id
    FROM public.properties p
    WHERE p.id = NEW.property_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  v_idx_name text;
  v_use_replica boolean := true;
  v_business_tables text[];
  v_pending text[];
  v_next text[];
  v_pass integer;
  v_added_cols integer := 0;
  v_added_idxs integer := 0;
  v_added_trgs integer := 0;
  v_truncate_list text;

  -- Platform-level tables: NEVER wiped, NEVER given tenant_id here
  platform_tables text[] := ARRAY[
    -- Tenant & organization core
    'tenants',
    'organizations',
    'system_users',
    'tenant_user_assignments',
    'organization_users',
    -- RBAC & user auth secrets
    'user_roles',
    'user_role_assignments',
    'roles',
    'permissions',
    'role_permissions',
    'permission_categories',
    'permission_versions',
    'department_permission_categories',
    'custom_roles',
    'mfa_secrets',
    -- Platform registries, system defaults & control-plane globals
    'modules',
    'global_settings',
    'setting_definitions',
    'admin_locales',
    'admin_reports',
    'admin_licenses',
    'admin_identity_providers',
    'api_keys',
    -- Scheduler / background job engine
    'scheduled_jobs',
    'scheduled_jobs_enhanced',
    'job_runs',
    'job_runs_enhanced',
    'job_execution_queue',
    'job_dependencies',
    -- Migration / audit scratch bookkeeping (if present in public)
    'schema_migrations',
    'supabase_migrations',
    '_prisma_migrations',
    '__drizzle_migrations',
    'drizzle_migrations',
    'knex_migrations',
    'typeorm_migrations',
    'sequelize_meta',
    'table_categories',
    'tenant_audit_results'
  ];

  -- Session / property-mapping tables: wiped, NOT given tenant_id
  delete_only_tables text[] := ARRAY[
    'user_sessions',
    'guest_sessions',
    'property_users'
  ];
BEGIN
  -- 0. Clear property/employee pointers on preserved platform tables before
  --    wiping properties/employees (must run before config_versions is wiped).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'global_settings' AND column_name = 'property_id'
  ) THEN
    UPDATE public.global_settings SET property_id = NULL WHERE property_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'global_settings' AND column_name = 'tenant_id'
  ) THEN
    DELETE FROM public.global_settings WHERE id <> 'main' AND tenant_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_jobs' AND column_name = 'property_id'
  ) THEN
    UPDATE public.scheduled_jobs SET property_id = NULL WHERE property_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'system_users' AND column_name = 'property_id'
  ) THEN
    UPDATE public.system_users SET property_id = NULL WHERE property_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'system_users' AND column_name = 'linked_employee_id'
  ) THEN
    UPDATE public.system_users SET linked_employee_id = NULL WHERE linked_employee_id IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_role_assignments' AND column_name = 'property_id'
  ) THEN
    UPDATE public.user_role_assignments SET property_id = NULL WHERE property_id IS NOT NULL;
  END IF;

  -- 1. Collect all real business tables in `public` (exclude views, child
  --    partitions, extension-owned tables, platform_tables, delete_only_tables).
  SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[])
  INTO v_business_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend d
      WHERE d.objid = c.oid
        AND d.classid = 'pg_catalog.pg_class'::regclass
        AND d.deptype = 'e'
    )
    AND c.relname <> ALL (platform_tables)
    AND c.relname <> ALL (delete_only_tables);

  -- 2. Try disabling triggers/FKs via session_replication_role = 'replica';
  --    fall back cleanly if the executing role lacks superuser privilege.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_use_replica := false;
  END;

  -- 3. Wipe session/mapping tables
  FOREACH t IN ARRAY delete_only_tables LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I', t);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;

  -- 4. Wipe all existing rows from business tables
  IF v_use_replica THEN
    FOREACH t IN ARRAY v_business_tables LOOP
      EXECUTE format('DELETE FROM public.%I', t);
    END LOOP;
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    -- Disable USER triggers (e.g. page_versions immutability, banquet audit triggers)
    FOREACH t IN ARRAY v_business_tables LOOP
      BEGIN
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;

    -- Iterative FK-safe delete passes (children clear before parents)
    v_pending := v_business_tables;
    FOR v_pass IN 1..25 LOOP
      v_next := ARRAY[]::text[];
      FOREACH t IN ARRAY v_pending LOOP
        BEGIN
          EXECUTE format('DELETE FROM public.%I', t);
        EXCEPTION WHEN foreign_key_violation THEN
          v_next := array_append(v_next, t);
        END;
      END LOOP;
      EXIT WHEN array_length(v_next, 1) IS NULL;
      v_pending := v_next;
    END LOOP;

    -- Break any remaining circular FK cycles via TRUNCATE ... CASCADE on
    -- those remaining tables only (never touches platform_tables).
    IF array_length(v_next, 1) IS NOT NULL THEN
      SELECT string_agg(format('public.%I', x), ', ')
      INTO v_truncate_list
      FROM unnest(v_next) AS x;
      EXECUTE 'TRUNCATE TABLE ' || v_truncate_list || ' CASCADE';
    END IF;

    -- Re-enable USER triggers
    FOREACH t IN ARRAY v_business_tables LOOP
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
  END IF;

  -- 5. Add tenant_id, index, and property_id->tenant_id backstop trigger
  FOREACH t IN ARRAY v_business_tables LOOP
    -- 5a. Add tenant_id column if missing
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = t
        AND c.column_name = 'tenant_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE',
        t
      );
      v_added_cols := v_added_cols + 1;
    END IF;

    -- 5b. Create index with tenant_id as leading column if none exists
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index ix
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = ix.indrelid
       AND a.attnum = ix.indkey[0]
      WHERE ix.indrelid = format('public.%I', t)::regclass
        AND a.attname = 'tenant_id'
        AND ix.indisvalid
    ) THEN
      v_idx_name := CASE
        WHEN length(t) <= 45 THEN 'idx_' || t || '_tenant_id'
        ELSE 'idx_' || left(t, 36) || '_' || substr(md5(t), 1, 8) || '_tenant_id'
      END;
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
        v_idx_name,
        t
      );
      v_added_idxs := v_added_idxs + 1;
    END IF;

    -- 5c. Attach backstop trigger for tables with a UUID property_id column
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = t
        AND c.column_name = 'property_id'
        AND c.data_type = 'uuid'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_tenant_id ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_set_tenant_id
           BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_property()',
        t
      );
      v_added_trgs := v_added_trgs + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '707 complete: business_tables=%, added_columns=%, added_indexes=%, attached_triggers=%',
    coalesce(array_length(v_business_tables, 1), 0), v_added_cols, v_added_idxs, v_added_trgs;
END $$;

-- ============================================================
-- purge_tenant_data(uuid): delete every row belonging to a tenant.
-- Dynamically sweeps ALL public business tables with a tenant_id column.
-- Used by DELETE /api/admin/tenants/:tenantId.
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_tenant_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  v_use_replica boolean := true;
  v_tables text[];
  v_pending text[];
  v_next text[];
  v_pass integer;
BEGIN
  -- Clean up rows in session/mapping tables that reference tenant parents
  BEGIN
    DELETE FROM public.guest_sessions
    WHERE guest_id IN (SELECT id FROM public.guests WHERE tenant_id = p_tenant_id);
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    DELETE FROM public.property_users
    WHERE property_id IN (SELECT id FROM public.properties WHERE tenant_id = p_tenant_id);
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN
    DELETE FROM public.global_settings
    WHERE tenant_id = p_tenant_id AND id <> 'main';
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[])
  INTO v_tables
  FROM information_schema.columns col
  JOIN pg_catalog.pg_namespace n ON n.nspname = col.table_schema
  JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = col.table_name
  WHERE col.table_schema = 'public'
    AND col.column_name = 'tenant_id'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND c.relname NOT IN ('tenants', 'global_settings');

  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION WHEN insufficient_privilege THEN
    v_use_replica := false;
  END;

  IF v_use_replica THEN
    FOREACH t IN ARRAY v_tables LOOP
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', t)
        USING p_tenant_id;
    END LOOP;
    PERFORM set_config('session_replication_role', 'origin', true);
  ELSE
    FOREACH t IN ARRAY v_tables LOOP
      BEGIN
        EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;

    v_pending := v_tables;
    FOR v_pass IN 1..25 LOOP
      v_next := ARRAY[]::text[];
      FOREACH t IN ARRAY v_pending LOOP
        BEGIN
          EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', t)
            USING p_tenant_id;
        EXCEPTION WHEN foreign_key_violation THEN
          v_next := array_append(v_next, t);
        END;
      END LOOP;
      EXIT WHEN array_length(v_next, 1) IS NULL;
      v_pending := v_next;
    END LOOP;

    FOREACH t IN ARRAY v_tables LOOP
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_tenant_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_tenant_data(uuid) TO service_role;

-- ============================================================
-- Verification summary (displayed in Supabase SQL Editor)
-- ============================================================
SELECT
  COUNT(*) FILTER (WHERE has_tenant_id) AS business_tables_with_tenant_id,
  COUNT(*) FILTER (WHERE NOT has_tenant_id) AS business_tables_missing_tenant_id
FROM (
  SELECT
    c.relname,
    EXISTS (
      SELECT 1 FROM information_schema.columns col
      WHERE col.table_schema = 'public'
        AND col.table_name = c.relname
        AND col.column_name = 'tenant_id'
    ) AS has_tenant_id
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend d
      WHERE d.objid = c.oid
        AND d.classid = 'pg_catalog.pg_class'::regclass
        AND d.deptype = 'e'
    )
    AND c.relname NOT IN (
      'tenants', 'organizations', 'system_users', 'tenant_user_assignments',
      'organization_users', 'user_roles', 'user_role_assignments', 'roles',
      'permissions', 'role_permissions', 'permission_categories',
      'permission_versions', 'department_permission_categories', 'custom_roles',
      'mfa_secrets', 'modules', 'global_settings', 'setting_definitions',
      'admin_locales', 'admin_reports', 'admin_licenses', 'admin_identity_providers',
      'api_keys', 'scheduled_jobs', 'scheduled_jobs_enhanced', 'job_runs',
      'job_runs_enhanced', 'job_execution_queue', 'job_dependencies',
      'schema_migrations', 'supabase_migrations', '_prisma_migrations',
      '__drizzle_migrations', 'drizzle_migrations', 'knex_migrations',
      'typeorm_migrations', 'sequelize_meta', 'table_categories', 'tenant_audit_results',
      'user_sessions', 'guest_sessions', 'property_users'
    )
) t;
