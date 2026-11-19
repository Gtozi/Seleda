-- 524_fix_permission_versions_user_roles_entity_type.sql
-- The audit trigger function log_permission_change() mapped
-- 'user_role_assignments' to the 'user_role' entity_type, but the actual
-- audited table is user_roles. Every INSERT/UPDATE/DELETE on user_roles
-- therefore produced entity_type='user_roles', violating
-- permission_versions_entity_type_check and breaking all role assignments.
-- Applied to the live DB ahead of 523 via the same statement below.

CREATE OR REPLACE FUNCTION public.log_permission_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_entity_id text;
BEGIN
  -- Try 'id' column first, fall back to composite key for join tables
  v_entity_id := COALESCE(
    to_jsonb(NEW)->>'id',
    to_jsonb(OLD)->>'id',
    NULL
  );

  IF v_entity_id IS NULL THEN
    -- For role_permissions: use role_id:permission_id composite key
    v_entity_id := COALESCE(
      (to_jsonb(NEW)->>'role_id') || ':' || (to_jsonb(NEW)->>'permission_id'),
      (to_jsonb(OLD)->>'role_id') || ':' || (to_jsonb(OLD)->>'permission_id'),
      'unknown'
    );
  END IF;

  INSERT INTO permission_versions (
    entity_type,
    entity_id,
    action,
    old_data,
    new_data,
    changed_by,
    changed_at,
    change_reason
  )
  VALUES (
    CASE TG_TABLE_NAME
      WHEN 'permissions' THEN 'permission'
      WHEN 'role_permissions' THEN 'role_permission'
      WHEN 'roles' THEN 'role'
      WHEN 'custom_roles' THEN 'custom_role'
      WHEN 'user_role_assignments' THEN 'user_role'
      WHEN 'user_roles' THEN 'user_role'
      ELSE TG_TABLE_NAME
    END,
    v_entity_id,
    CASE TG_OP
      WHEN 'INSERT' THEN 'create'
      WHEN 'UPDATE' THEN 'update'
      WHEN 'DELETE' THEN 'delete'
      ELSE lower(TG_OP)
    END,
    to_jsonb(OLD),
    to_jsonb(NEW),
    current_setting('app.user_id', true)::text,
    now(),
    CASE
      WHEN TG_OP = 'DELETE' THEN 'Record deleted'
      WHEN TG_OP = 'INSERT' THEN 'Record created'
      WHEN TG_OP = 'UPDATE' THEN 'Record updated'
      ELSE 'Unknown action'
    END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;
