-- Migration 234: Fix group_audit_log action values used by link/unlink functions
--
-- Problem: The live CHECK constraint `group_audit_log_action_check` allows:
--   group_created, group_updated, group_deleted, guest_linked, guest_unlinked,
--   relationship_updated, analytics_updated, status_changed
--
-- But `link_guest_to_group()` inserts action = 'relationship_created' (NOT allowed)
-- and `unlink_guest_from_group()` inserts action = 'relationship_terminated'
-- (NOT allowed). Both calls fail with:
--   ERROR 23514: new row for relation "group_audit_log" violates check
--   constraint "group_audit_log_action_check"
--
-- This caused the POST /api/group-profiles/:id/link-guest 500 error during
-- group booking creation (the relationship row was inserted, but the function
-- rolled back when the audit-log INSERT failed).
--
-- Fix:
--   1. Update link_guest_to_group() to use 'guest_linked' for new relationships
--      (keeps 'relationship_updated' for the update path, which is allowed).
--   2. Update unlink_guest_from_group() to use 'guest_unlinked'.
--   3. Expand the CHECK constraint to also accept 'relationship_created' and
--      'relationship_terminated' for backward compatibility with any older
--      code paths / rows that may still use them.

-- ── 1. Expand the CHECK constraint to include legacy action values ──────────
ALTER TABLE public.group_audit_log
  DROP CONSTRAINT IF EXISTS group_audit_log_action_check;

ALTER TABLE public.group_audit_log
  ADD CONSTRAINT group_audit_log_action_check CHECK (
    action = ANY (ARRAY[
      'group_created'::text,
      'group_updated'::text,
      'group_deleted'::text,
      'guest_linked'::text,
      'guest_unlinked'::text,
      'relationship_created'::text,
      'relationship_updated'::text,
      'relationship_terminated'::text,
      'analytics_updated'::text,
      'status_changed'::text
    ])
  );

-- ── 2. Fix link_guest_to_group(): use 'guest_linked' for new relationships ──
CREATE OR REPLACE FUNCTION public.link_guest_to_group(
  p_guest_id text,
  p_group_id text,
  p_relationship_type text,
  p_is_primary_contact boolean DEFAULT false,
  p_reservation_id text DEFAULT NULL::text,
  p_user_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_existing_relationship record;
  v_group_type text;
  v_new_relationship_id text;
begin
  -- Validate inputs
  if not exists (select 1 from guests where id = p_guest_id) then
    return jsonb_build_object('success', false, 'error', 'Guest not found');
  end if;

  if not exists (select 1 from group_profiles where id = p_group_id) then
    return jsonb_build_object('success', false, 'error', 'Group not found');
  end if;

  -- Get group type
  select type into v_group_type from group_profiles where id = p_group_id;

  -- Check for existing active relationship
  select * into v_existing_relationship from guest_group_relationships
  where guest_id = p_guest_id
    and group_id = p_group_id
    and status = 'Active'
    and (end_date is null or end_date >= current_date)
  limit 1;

  if v_existing_relationship is not null then
    -- Update existing relationship
    update guest_group_relationships
    set is_primary_contact = p_is_primary_contact,
        reservation_id = coalesce(p_reservation_id, reservation_id),
        updated_at = now(),
        updated_by = p_user_id
    where id = v_existing_relationship.id;

    -- Log audit
    insert into group_audit_log (
      id, action, entity_type, entity_id, group_id, guest_id,
      relationship_id, previous_values, new_values, user_id, user_name
    ) values (
      gen_random_uuid()::text,
      'relationship_updated',
      'GuestGroupRelationship',
      v_existing_relationship.id,
      p_group_id,
      p_guest_id,
      v_existing_relationship.id,
      jsonb_build_object('isPrimaryContact', v_existing_relationship.is_primary_contact),
      jsonb_build_object('isPrimaryContact', p_is_primary_contact),
      p_user_id,
      (select name from system_users where id = p_user_id limit 1)
    );

    return jsonb_build_object('success', true, 'action', 'updated', 'relationshipId', v_existing_relationship.id);
  end if;

  -- Create new relationship
  v_new_relationship_id := gen_random_uuid()::text;

  insert into guest_group_relationships (
    id, guest_id, group_id, reservation_id, relationship_type,
    status, start_date, is_primary_contact, created_at, created_by
  ) values (
    v_new_relationship_id,
    p_guest_id,
    p_group_id,
    p_reservation_id,
    coalesce(p_relationship_type, v_group_type),
    'Active',
    current_date,
    p_is_primary_contact,
    now(),
    p_user_id
  );

  -- Update guest's parent_group_id for backward compatibility
  update guests
  set parent_group_id = p_group_id,
      is_primary_contact = p_is_primary_contact
  where id = p_guest_id;

  -- Log audit (use 'guest_linked' which is in the CHECK constraint)
  insert into group_audit_log (
    id, action, entity_type, entity_id, group_id, guest_id,
    relationship_id, new_values, user_id, user_name
  ) values (
    gen_random_uuid()::text,
    'guest_linked',
    'GuestGroupRelationship',
    v_new_relationship_id,
    p_group_id,
    p_guest_id,
    v_new_relationship_id,
    jsonb_build_object(
      'guestId', p_guest_id,
      'groupId', p_group_id,
      'relationshipType', coalesce(p_relationship_type, v_group_type),
      'isPrimaryContact', p_is_primary_contact
    ),
    p_user_id,
    (select name from system_users where id = p_user_id limit 1)
  );

  return jsonb_build_object('success', true, 'action', 'created', 'relationshipId', v_new_relationship_id);
end;
$$;

-- ── 3. Fix unlink_guest_from_group(): use 'guest_unlinked' ──────────────────
CREATE OR REPLACE FUNCTION public.unlink_guest_from_group(
  p_guest_id text,
  p_group_id text,
  p_reason text DEFAULT NULL::text,
  p_user_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_existing_relationship record;
begin
  -- Find active relationship
  select * into v_existing_relationship from guest_group_relationships
  where guest_id = p_guest_id
    and group_id = p_group_id
    and status = 'Active'
    and (end_date is null or end_date >= current_date)
  limit 1;

  if v_existing_relationship is null then
    return jsonb_build_object('success', false, 'error', 'No active relationship found');
  end if;

  -- Terminate relationship
  update guest_group_relationships
  set status = 'Terminated',
      end_date = current_date,
      updated_at = now(),
      updated_by = p_user_id
  where id = v_existing_relationship.id;

  -- Clear guest's parent_group_id if this was the primary group
  update guests
  set parent_group_id = null,
      is_primary_contact = false
  where id = p_guest_id and parent_group_id = p_group_id;

  -- Log audit (use 'guest_unlinked' which is in the CHECK constraint)
  insert into group_audit_log (
    id, action, entity_type, entity_id, group_id, guest_id,
    relationship_id, previous_values, new_values, reason, user_id, user_name
  ) values (
    gen_random_uuid()::text,
    'guest_unlinked',
    'GuestGroupRelationship',
    v_existing_relationship.id,
    p_group_id,
    p_guest_id,
    v_existing_relationship.id,
    jsonb_build_object('status', 'Active', 'endDate', null),
    jsonb_build_object('status', 'Terminated', 'endDate', current_date),
    p_reason,
    p_user_id,
    (select name from system_users where id = p_user_id limit 1)
  );

  return jsonb_build_object('success', true, 'action', 'terminated', 'relationshipId', v_existing_relationship.id);
end;
$$;

GRANT EXECUTE ON FUNCTION public.link_guest_to_group(text, text, text, boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_guest_from_group(text, text, text, text) TO anon, authenticated;
