-- Migration 231: Fix guest lookup to check both email AND name
--
-- Previously, database functions and triggers were looking up guests by email only,
-- which caused incorrect guest profile reuse when different guests shared the same email.
-- This migration updates all guest lookup logic to require both email AND name to match.
--
-- This fixes the issue where Lemn would use Hagos's profile if they shared an email address.

-- ================================================================================
-- STEP 1: Fix ensure_reservation_group_profile_and_guest trigger function
-- ================================================================================

CREATE OR REPLACE FUNCTION public.ensure_reservation_group_profile_and_guest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_group_id text;
  v_group_ref text;
  v_group_name text;
  v_guest_id text;
begin
  -- Create group profile for group bookings
  if new.booking_group_id is not null or new.group_booking_id is not null then
    v_group_ref := coalesce(new.booking_group_id, new.group_booking_id);
    v_group_name := coalesce(new.guest_name, 'Group Reservation');

    insert into group_profiles (
      id, external_id, group_name, type, status,
      contact_name, contact_email, contact_phone,
      organization_name, created_at, updated_at
    ) values (
      v_group_ref,
      'GRP-' || v_group_ref,
      v_group_name,
      'GroupReservation',
      'Active',
      new.guest_name,
      new.guest_email,
      new.guest_phone,
      v_group_name,
      now(),
      now()
    )
    on conflict (id) do nothing
    returning id into v_group_id;

    if v_group_id is null then
      select id into v_group_id from group_profiles where id = v_group_ref;
    end if;
  end if;

  -- Resolve a guest_id for this reservation if needed
  -- Use AND condition to ensure both email AND name match before reusing guest profile
  if new.guest_id is null and new.guest_email is not null then
    select id into v_guest_id from guests
    where email = new.guest_email
      and name = new.guest_name
    limit 1;

    if v_guest_id is null then
      v_guest_id := 'G-' || gen_random_uuid()::text;
      insert into guests (
        id, name, email, phone, status,
        loyalty_points, special_requests, notes,
        total_spend, preferences, identification_doc
      ) values (
        v_guest_id,
        new.guest_name,
        new.guest_email,
        new.guest_phone,
        coalesce(new.guest_status, 'Regular'),
        0,
        '',
        'Auto-created from reservation ' || new.id,
        0,
        '{}'::jsonb,
        '{}'::jsonb
      )
      on conflict (id) do nothing
      returning id into v_guest_id;
      if v_guest_id is null then
        select id into v_guest_id from guests
        where email = new.guest_email
          and name = new.guest_name
        limit 1;
      end if;
    end if;

    new.guest_id := v_guest_id;
  end if;

  return new;
end;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trigger_ensure_reservation_group_profile_and_guest ON public.reservations;

CREATE TRIGGER trigger_ensure_reservation_group_profile_and_guest
BEFORE INSERT OR UPDATE OF status, booking_group_id, group_booking_id, guest_email
ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION ensure_reservation_group_profile_and_guest();

GRANT EXECUTE ON FUNCTION public.ensure_reservation_group_profile_and_guest() TO anon;
GRANT EXECUTE ON FUNCTION public.ensure_reservation_group_profile_and_guest() TO authenticated;

-- ================================================================================
-- STEP 2: Fix auto_link_guest_to_group trigger function
-- ================================================================================

CREATE OR REPLACE FUNCTION public.auto_link_guest_to_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_group_id text;
  v_guest_id text;
  v_relationship_type text;
  v_existing_relationship record;
begin
  -- Extract group_id from reservation
  if new.booking_group_id is not null then
    v_group_id := new.booking_group_id;
  elsif new.group_booking_id is not null then
    v_group_id := new.group_booking_id;
  else
    return new;
  end if;

  -- Determine relationship type from group profile
  select type into v_relationship_type from group_profiles where id = v_group_id limit 1;

  -- Check if guest profile exists and get the guest_id
  -- Use AND condition to ensure both email AND name match before reusing guest profile
  select id into v_guest_id from guests
  where email = new.guest_email
    and name = new.guest_name
  order by created_at asc  -- Consistent ordering if duplicates exist
  limit 1;

  if v_guest_id is null then
    -- Guest profile doesn't exist yet - will be created separately
    return new;
  end if;

  -- Check for existing active relationship
  select * into v_existing_relationship from guest_group_relationships
  where guest_id = v_guest_id
    and group_id = v_group_id
    and status = 'Active'
  limit 1;

  if v_existing_relationship is not null then
    -- Update existing relationship with latest reservation info
    update guest_group_relationships
    set
      updated_at = now(),
      relationship_type = v_relationship_type,
      reservation_id = new.id
    where id = v_existing_relationship.id;
  else
    -- Create new relationship
    insert into guest_group_relationships (
      id,
      guest_id,
      group_id,
      reservation_id,
      relationship_type,
      status,
      created_at,
      updated_at
    ) values (
      gen_random_uuid()::text,
      v_guest_id,
      v_group_id,
      new.id,
      v_relationship_type,
      'Active',
      now(),
      now()
    );
  end if;

  return new;
end;
$$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trigger_auto_link_guest_to_group ON public.reservations;

CREATE TRIGGER trigger_auto_link_guest_to_group
AFTER INSERT OR UPDATE OF booking_group_id, group_booking_id, guest_email
ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION auto_link_guest_to_group();

GRANT EXECUTE ON FUNCTION public.auto_link_guest_to_group() TO anon;
GRANT EXECUTE ON FUNCTION public.auto_link_guest_to_group() TO authenticated;

-- ================================================================================
-- STEP 3: Fix any remaining guest lookup in schema functions
-- ================================================================================

-- Note: The handle_group_booking_member_linkage function from migration 003
-- is a standalone function with specific parameters, not a trigger function.
-- It should be fixed separately if it's still in use. The main guest lookup
-- issues are in the trigger functions and create_booking_atomic which are
-- fixed in Steps 1, 2, and 4.

-- ================================================================================
-- STEP 3: Fix existing create_booking_atomic function guest lookup
-- ================================================================================

DROP FUNCTION IF EXISTS public.create_booking_atomic(
  text, text, text, text, text, text, date, date, jsonb,
  text[], text[], numeric, numeric, numeric, numeric, text, uuid, numeric, numeric, numeric, text, text
);

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_idempotency_key text,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_guest_nationality text,
  p_special_requests text,
  p_check_in date,
  p_check_out date,
  p_items jsonb,
  p_package_ids text[],
  p_guest_service_ids text[],
  p_package_total numeric,
  p_guest_svc_total numeric,
  p_tax_percent numeric,
  p_svc_charge_pct numeric,
  p_group_name text,
  p_operator_id uuid,
  p_tax_amount numeric,
  p_svc_amount numeric,
  p_addon_amount numeric,
  p_channel text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_existing_ids text[];
  v_nights integer;
  v_capacity integer;
  v_booked integer;
  v_available integer;
  v_allotment_block integer := 0;
  v_total_qty integer := 0;
  v_subtotal numeric := 0;
  v_is_group boolean;
  v_group_id text;
  v_reservation_ids text[] := '{}';
  v_guest_ids text[] := '{}';
  v_guest_id text;
  v_item jsonb;
  v_qty integer;
  v_i integer;
  v_rate numeric;
  v_item_total numeric;
  v_reservation_id text;
  v_room_index integer := 0;
  v_room_guest_id text;
  v_room_guest_name text;
  v_room_guest_email text;
  v_segments jsonb;
  v_current_room text;
  v_current_start date;
  v_current_nights integer;
  v_desired_room text;
  v_night_idx integer;
  v_first_res boolean := true;
begin
  -- Idempotency guard
  select array_agg(id) into v_existing_ids
  from reservations
  where idempotency_key = p_idempotency_key;

  if v_existing_ids is not null and array_length(v_existing_ids, 1) > 0 then
    select array_agg(guest_id) into v_guest_ids
    from reservations
    where idempotency_key = p_idempotency_key;

    return jsonb_build_object(
      'reservationIds', v_existing_ids,
      'guestIds', v_guest_ids,
      'groupId', (select booking_group_id from reservations where idempotency_key = p_idempotency_key limit 1)
    );
  end if;

  -- Date math
  v_nights := greatest(1, (p_check_out - p_check_in));

  -- Availability check WITH row-level lock
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform id from room_types
      where name = (v_item->>'roomTypeName')
      for update;

    -- Sellable capacity excludes rooms that are physically unavailable
    select count(*) into v_capacity
    from rooms r
    join room_types rt on r.type = rt.name
    where rt.name = (v_item->>'roomTypeName')
      and r.status not in ('Out of Order', 'Out of Service', 'Maintenance');

    select count(*) into v_booked
    from reservations res
    where res.room_type = (v_item->>'roomTypeName')
      and (
        res.status in ('Confirmed', 'CheckedIn')
        or (res.status = 'Waitlisted' and res.channel = 'Direct Website')
      )
      and res.check_in_date < p_check_out
      and res.check_out_date > p_check_in;

    begin
      select coalesce(sum(greatest(0, a.blocked_qty - a.picked_up_qty)), 0)
      into v_allotment_block
      from allotments a
      join room_types rt on a.room_type_id = rt.id
      where rt.name = (v_item->>'roomTypeName')
        and a.release_date >= current_date
        and a.stay_date >= p_check_in
        and a.stay_date < p_check_out;
    exception when undefined_table then
      v_allotment_block := 0;
    end;

    v_available := greatest(0, v_capacity - v_booked - v_allotment_block);

    if v_available < (v_item->>'qty')::integer then
      raise exception 'AVAILABILITY_ERROR:% room(s) available for %, requested %',
        v_available, v_item->>'roomTypeName', v_item->>'qty';
    end if;

    v_total_qty := v_total_qty + (v_item->>'qty')::integer;
    v_subtotal  := v_subtotal + ((v_item->>'rate')::numeric * v_nights * (v_item->>'qty')::integer);
  end loop;

  v_subtotal := v_subtotal + coalesce(p_package_total, 0) + coalesce(p_guest_svc_total, 0);
  v_is_group := v_total_qty > 1;

  -- Insert group booking (if multi-room)
  if v_is_group then
    v_group_id := upper(substring(md5(random()::text) from 1 for 8));
    insert into group_bookings (
      id, group_name, contact_name, contact_email, contact_phone,
      room_type_needed, room_count, check_in_date, check_out_date,
      discount_percent, status
    ) values (
      v_group_id,
      coalesce(p_group_name, p_guest_name),
      p_guest_name, p_guest_email,
      coalesce(p_guest_phone, ''),
      (p_items->0->>'roomTypeName'),
      v_total_qty, p_check_in, p_check_out,
      0, 'Pending'
    );
  end if;

  -- Insert reservations per item × qty
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::integer;
    for v_i in 1..v_qty loop
      -- Create per-room guest profile for group bookings
      v_room_index := v_room_index + 1;
      if v_is_group then
        v_room_guest_id := upper(substring(md5(random()::text) from 1 for 8));
        v_room_guest_name := case when v_room_index = 1
          then p_guest_name
          else p_guest_name || ' (Room ' || v_room_index || ')'
        end;
        v_room_guest_email := case when v_room_index = 1
          then p_guest_email
          else replace(p_guest_email, '@', '+room' || v_room_index || '@')
        end;

        insert into guests (
          id, name, email, phone, nationality, status,
          loyalty_points, special_requests, notes, total_spend, preferences,
          is_primary_contact
        ) values (
          v_room_guest_id, v_room_guest_name, v_room_guest_email,
          coalesce(p_guest_phone, ''), coalesce(p_guest_nationality, ''),
          'Regular', 0, coalesce(p_special_requests, ''),
          'Direct website group booking — Room ' || v_room_index, 0, '{}'::jsonb,
          v_room_index = 1
        );

        v_guest_ids := v_guest_ids || v_room_guest_id;
      else
        -- Single booking: check for existing guest with matching email AND name
        if v_room_index = 1 then
          -- Use AND condition to ensure both email AND name match before reusing guest profile
          select id into v_guest_id from guests
          where email = p_guest_email
            and name = p_guest_name
          limit 1;

          if v_guest_id is null then
            v_guest_id := upper(substring(md5(random()::text) from 1 for 8));
            insert into guests (
              id, name, email, phone, nationality, status,
              loyalty_points, special_requests, notes, total_spend, preferences
            ) values (
              v_guest_id, p_guest_name, p_guest_email,
              coalesce(p_guest_phone, ''), coalesce(p_guest_nationality, ''),
              'Regular', 0, coalesce(p_special_requests, ''),
              'Direct website booking — pending front desk promotion', 0, '{}'::jsonb
            );
          end if;

          v_room_guest_id := v_guest_id;
          v_guest_ids := v_guest_ids || v_room_guest_id;
        end if;
      end if;

      -- Create reservation
      v_reservation_id := 'RES-' || upper(substring(md5(random()::text) from 1 for 8));
      v_rate := (v_item->>'rate')::numeric;
      v_item_total := v_rate * v_nights;

      insert into reservations (
        id, guest_id, guest_name, guest_email, guest_phone,
        room_type, check_in_date, check_out_date, adults, children,
        rate, total_amount, channel, status, notes,
        idempotency_key, booking_group_id, group_booking_id,
        package_ids, guest_service_ids, created_at, updated_at
      ) values (
        v_reservation_id, v_room_guest_id, p_guest_name, p_guest_email, p_guest_phone,
        (v_item->>'roomTypeName'), p_check_in, p_check_out,
        coalesce((v_item->>'adults')::integer, 1),
        coalesce((v_item->>'children')::integer, 0),
        v_rate, v_item_total, p_channel, p_status, p_special_requests,
        p_idempotency_key, v_group_id, v_group_id,
        p_package_ids, p_guest_service_ids, now(), now()
      );

      v_reservation_ids := v_reservation_ids || v_reservation_id;
    end loop;
  end loop;

  return jsonb_build_object(
    'reservationIds', v_reservation_ids,
    'guestIds', v_guest_ids,
    'groupId', v_group_id
  );
end;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.create_booking_atomic TO anon;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic TO authenticated;

-- ================================================================================
-- END OF MIGRATION
-- ================================================================================

-- Migration summary:
-- 1. Updated ensure_reservation_group_profile_and_guest() to check both email AND name
-- 2. Updated auto_link_guest_to_group() to check both email AND name
-- 3. Updated create_booking_atomic() to check both email AND name for single bookings
--
-- This ensures that guest profiles are only reused when BOTH email AND name match exactly,
-- preventing incorrect guest profile reuse when different guests share only email or name.
