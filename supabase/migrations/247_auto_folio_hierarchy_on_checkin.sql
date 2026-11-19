-- Migration 247: Auto-create folio hierarchy on group check-in
--
-- When a reservation that belongs to a group is checked in, the
-- check_in_reservation function only created a Guest folio. This patch
-- adds logic to also create/link the Group, Company, and Master folios
-- so the Account → Master → Group → Guest tree is complete.
--
-- Folios store group_profiles.code in owner_id (Company/Master) and
-- group_id (Group), matching the pattern established in migration 244.

-- First, a reusable helper that ensures the folio hierarchy exists for
-- a given group_profile_id + reservation_id, and returns the Master
-- folio id (which the Guest folio should be linked to via parent_folio_id).
create or replace function ensure_group_folio_hierarchy(
  p_group_profile_id text,
  p_reservation_id   text,
  p_user_id          text default null
)
returns text  -- returns the Master folio id, or null if no group
language plpgsql
security definer
as $$
declare
  v_group          group_profiles%rowtype;
  v_company        group_profiles%rowtype;
  v_company_code   text;
  v_company_folio_id text;
  v_group_folio_id   text;
  v_master_folio_id  text;
  v_now            timestamptz := now();
begin
  if p_group_profile_id is null then
    return null;
  end if;

  -- Load the group profile
  select * into v_group from group_profiles where id = p_group_profile_id limit 1;
  if not found then
    return null;
  end if;

  -- ── 1. Company folio ──────────────────────────────────────
  -- A Company folio is created when the group profile is a corporate
  -- account type (CorporateAccount, TravelAgent, TourOperator, etc.)
  -- OR when the group has a parent corporate account.
  v_company_code := null;

  if v_group.type in ('CorporateAccount', 'TravelAgent', 'TourOperator', 'LongTermContract') then
    -- This group profile IS the company
    v_company_code := v_group.code;
  else
    -- Look for a parent corporate account via guests.parent_corporate_id
    -- or check if there's another group_profile with the same organization_name
    -- that is a corporate type.
    select gp.code into v_company_code
    from group_profiles gp
    where gp.type in ('CorporateAccount', 'TravelAgent', 'TourOperator', 'LongTermContract')
      and (
        gp.organization_name = v_group.organization_name
        or gp.id = (
          select g.parent_corporate_id
          from guests g
          where g.parent_group_id = v_group.id
            and g.parent_corporate_id is not null
          limit 1
        )
      )
      and gp.organization_name is not null
    limit 1;
  end if;

  if v_company_code is not null then
    -- Find or create Company folio
    select id into v_company_folio_id
    from folios
    where owner_type = 'group_profile'
      and owner_id = v_company_code
      and folio_type = 'Company'
      and status = 'Open'
    limit 1;

    if v_company_folio_id is null then
      v_company_folio_id := gen_random_uuid()::text;
      insert into folios (
        id, folio_type, status, balance, total_charges, total_payments,
        currency, owner_type, owner_id, opened_at, created_by, notes
      ) values (
        v_company_folio_id, 'Company', 'Open', 0, 0, 0,
        'USD', 'group_profile', v_company_code, v_now, p_user_id,
        'Company folio for ' || v_company_code
      );
    end if;
  end if;

  -- ── 2. Group folio ────────────────────────────────────────
  select id into v_group_folio_id
  from folios
  where folio_type = 'Group'
    and group_id = v_group.code
    and status = 'Open'
  limit 1;

  if v_group_folio_id is null then
    v_group_folio_id := gen_random_uuid()::text;
    insert into folios (
      id, folio_type, status, balance, total_charges, total_payments,
      currency, group_id, parent_folio_id, opened_at, created_by, notes
    ) values (
      v_group_folio_id, 'Group', 'Open', 0, 0, 0,
      'USD', v_group.code, v_company_folio_id, v_now, p_user_id,
      'Group folio for ' || v_group.code || ' (' || coalesce(v_group.name, '') || ')'
    );
  else
    -- Ensure parent link is set if Company folio was just created
    if v_company_folio_id is not null then
      update folios set parent_folio_id = v_company_folio_id
      where id = v_group_folio_id and parent_folio_id is null;
    end if;
  end if;

  -- ── 3. Master folio ───────────────────────────────────────
  -- One shared Master folio per group (routes all charges centrally)
  if v_company_folio_id is not null then
    select id into v_master_folio_id
    from folios
    where folio_type = 'Master'
      and owner_type = 'group_profile'
      and owner_id = v_company_code
      and status = 'Open'
    limit 1;
  else
    select id into v_master_folio_id
    from folios
    where folio_type = 'Master'
      and group_id = v_group.code
      and status = 'Open'
    limit 1;
  end if;

  if v_master_folio_id is null then
    v_master_folio_id := gen_random_uuid()::text;
    insert into folios (
      id, folio_type, target_folio, status, balance, total_charges, total_payments,
      currency, owner_type, owner_id, group_id, parent_folio_id, opened_at, created_by, notes
    ) values (
      v_master_folio_id, 'Master', 'A', 'Open', 0, 0, 0,
      'USD',
      case when v_company_code is not null then 'group_profile' else null end,
      v_company_code,
      v_group.code,
      v_group_folio_id,
      v_now, p_user_id,
      'Master folio for ' || coalesce(v_company_code, v_group.code)
    );
  end if;

  return v_master_folio_id;
end;
$$;

grant execute on function ensure_group_folio_hierarchy to authenticated;

-- ── Patch check_in_reservation to call the helper ─────────────
-- We recreate the function with the hierarchy logic added right after
-- the Guest folio is created. The rest of the function is unchanged.

-- Drop all versions first
DO $$
DECLARE func_record RECORD;
BEGIN
  FOR func_record IN
    SELECT oid FROM pg_proc WHERE proname = 'check_in_reservation'
  LOOP
    EXECUTE 'DROP FUNCTION ' || func_record.oid::regprocedure || ' CASCADE';
  END LOOP;
END $$;

create or replace function check_in_reservation(
  p_reservation_id text,
  p_user_id text,
  p_room_number text default null,
  p_payment_method text default null,
  p_payment_amount numeric default null,
  p_payment_reference text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_reservation reservations%rowtype;
  v_folio_id text;
  v_master_folio_id text;
  v_group_profile_id text;
  v_line_num integer;
  v_business_date date;
  v_now timestamp with time zone := now();
  v_base_amount numeric;
  v_discount_percent numeric := 0.0;
  v_discount_amount numeric := 0.00;
  v_discounted_base numeric;
  v_fee record;
  v_fee_amount numeric;
  v_non_vat_fees numeric := 0.00;
  v_vat_amount numeric := 0.00;
  v_vat_name text := '';
  v_vat_rate numeric := 0;
  v_vat_account text := '';
  v_sc_total numeric := 0.00;
  v_payment_id text;
begin
  select business_date into v_business_date from business_dates where id = 'current';
  if v_business_date is null then v_business_date := current_date; end if;

  -- Lock reservation
  select * into v_reservation
  from reservations
  where id = p_reservation_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Reservation not found');
  end if;

  if v_reservation.status = 'CheckedIn' then
    return jsonb_build_object('success', false, 'error', 'Reservation already checked in');
  end if;

  -- Update reservation status and room assignment
  update reservations
  set status = 'CheckedIn',
      check_in_date = v_now,
      check_out_date = v_reservation.check_out_date,
      room_number = coalesce(p_room_number, room_number)
  where id = p_reservation_id;

  -- ── Ensure folio hierarchy for group reservations ────────
  -- If this reservation belongs to a group, create/link the
  -- Company → Group → Master folio chain and get the Master folio id.
  v_master_folio_id := null;
  if v_reservation.group_profile_id is not null then
    v_master_folio_id := ensure_group_folio_hierarchy(
      v_reservation.group_profile_id, p_reservation_id, p_user_id
    );
  elsif v_reservation.booking_group_id is not null then
    -- Resolve booking_group_id (a code) to group_profile_id
    select gp.id into v_group_profile_id
    from group_profiles gp
    where gp.code = v_reservation.booking_group_id or gp.id = v_reservation.booking_group_id
    limit 1;
    if v_group_profile_id is not null then
      v_master_folio_id := ensure_group_folio_hierarchy(
        v_group_profile_id, p_reservation_id, p_user_id
      );
    end if;
  end if;

  -- Create Guest folio if not exists
  select id into v_folio_id
  from folios
  where reservation_id = p_reservation_id
    and status = 'Open'
  limit 1;

  if v_folio_id is null then
    v_folio_id := gen_random_uuid()::text;
    insert into folios (
      id, reservation_id, folio_type, status, balance, total_charges, total_payments,
      currency, opened_at, created_by, parent_folio_id
    ) values (
      v_folio_id, p_reservation_id, 'Guest', 'Open', 0, 0, 0,
      'USD', v_now, p_user_id, v_master_folio_id
    );
  elsif v_master_folio_id is not null then
    -- Link existing Guest folio to Master if not already linked
    update folios set parent_folio_id = v_master_folio_id
    where id = v_folio_id and parent_folio_id is null;
  end if;

  -- Calculate base amount from reservation charges
  v_base_amount := coalesce(v_reservation.total_amount, 0);
  v_discount_percent := coalesce(v_reservation.discount_percent, 0);

  -- Calculate discount
  if v_discount_percent > 0 then
    v_discount_amount := round(v_base_amount * v_discount_percent / 100, 2);
  end if;
  v_discounted_base := v_base_amount - v_discount_amount;

  -- Get next line number
  select coalesce(max(line_number), 0) + 1 into v_line_num
  from folio_lines
  where folio_id = v_folio_id;

  -- Insert base room charge line
  insert into folio_lines (
    id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
    line_type, target_folio, revenue_account_code, source_module, created_by
  ) values (
    gen_random_uuid()::text, v_folio_id, v_line_num, v_business_date,
    'Room charge - ' || coalesce(v_reservation.room_type, 'reservation'),
    v_base_amount, 1, v_base_amount, 'Room', null,
    (select code from chart_of_accounts where name ilike '%room revenue%' limit 1),
    'frontoffice', p_user_id
  );

  -- Insert discount line if applicable
  if v_discount_percent > 0 then
    v_line_num := v_line_num + 1;
    insert into folio_lines (
      id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
      line_type, target_folio, revenue_account_code, source_module, created_by
    ) values (
      gen_random_uuid()::text, v_folio_id, v_line_num, v_business_date,
      'Discount @ ' || v_discount_percent || '% on room charge',
      -v_discount_amount, 1, -v_discount_amount, 'Discount', null,
      (select code from chart_of_accounts where name ilike '%discount%' limit 1),
      'frontoffice', p_user_id
    );
  end if;

  -- Phase 1: Calculate non-VAT fees on the discounted base, insert lines
  for v_fee in
    select
      (elem->>'name')::text as name,
      (elem->>'feeType')::text as fee_type,
      (elem->>'value')::numeric as value,
      (elem->>'accountCode')::text as account_code
    from global_settings, jsonb_array_elements(fee_components) as elem
    where global_settings.id = 'main'
    and (elem->>'isEnabled')::boolean = true
    and lower((elem->>'name')::text) not like '%vat%'
    and lower((elem->>'name')::text) not like '%tax%'
    order by (elem->>'displayOrder')::int asc
  loop
    v_line_num := v_line_num + 1;
    if v_fee.fee_type = 'percentage' then
      v_fee_amount := round(v_discounted_base * v_fee.value / 100, 2);
    else
      v_fee_amount := v_fee.value;
    end if;
    v_non_vat_fees := v_non_vat_fees + v_fee_amount;

    if lower(v_fee.name) like '%service charge%' or lower(v_fee.name) like '%service%' then
      v_sc_total := v_sc_total + v_fee_amount;
    end if;

    insert into folio_lines (
      id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
      line_type, target_folio, revenue_account_code, source_module, created_by
    ) values (
      gen_random_uuid()::text, v_folio_id, v_line_num, v_business_date,
      v_fee.name || case when v_fee.fee_type = 'percentage' then ' @ ' || v_fee.value || '% on room charge' else ' (Fixed) on room charge' end,
      v_fee_amount, 1, v_fee_amount,
      case
        when lower(v_fee.name) like '%service charge%' or lower(v_fee.name) like '%service%' then 'ServiceCharge'
        else 'Extra'
      end,
      null,
      coalesce(v_fee.account_code, (select code from chart_of_accounts where name ilike '%miscellaneous%' limit 1)),
      'frontoffice', p_user_id
    );
  end loop;

  -- Phase 2: Calculate VAT on (discounted base + non-VAT fees), insert last
  select
    (elem->>'name')::text,
    (elem->>'value')::numeric,
    (elem->>'accountCode')::text
  into v_vat_name, v_vat_rate, v_vat_account
  from global_settings, jsonb_array_elements(fee_components) as elem
  where global_settings.id = 'main'
  and (elem->>'isEnabled')::boolean = true
  and (lower((elem->>'name')::text) like '%vat%' or lower((elem->>'name')::text) like '%tax%')
  limit 1;

  if v_vat_name is not null and v_vat_rate > 0 then
    v_vat_amount := round((v_discounted_base + v_non_vat_fees) * v_vat_rate / 100, 2);
    v_line_num := v_line_num + 1;
    insert into folio_lines (
      id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
      line_type, target_folio, revenue_account_code, source_module, created_by
    ) values (
      gen_random_uuid()::text, v_folio_id, v_line_num, v_business_date,
      v_vat_name || ' @ ' || v_vat_rate || '% on room charge',
      v_vat_amount, 1, v_vat_amount, 'Tax', null,
      coalesce(v_vat_account, (select code from chart_of_accounts where name ilike '%tax payable%' limit 1)),
      'frontoffice', p_user_id
    );
  end if;

  -- Update folio balance
  update folios
  set balance = balance + v_discounted_base + v_non_vat_fees + v_vat_amount,
      total_charges = total_charges + v_discounted_base + v_non_vat_fees + v_vat_amount,
      tax_total = tax_total + v_vat_amount,
      service_charge_total = service_charge_total + v_sc_total,
      updated_at = v_now
  where id = v_folio_id;

  -- Process payment if provided
  if p_payment_amount is not null and p_payment_amount > 0 then
    insert into folio_payments (
      id, folio_id, amount, payment_method, reference_number, user_id, created_at
    ) values (
      gen_random_uuid()::text, v_folio_id, p_payment_amount, p_payment_method, p_payment_reference, p_user_id, v_now
    ) returning id into v_payment_id;

    update folios
    set total_payments = total_payments + p_payment_amount,
        balance = balance - p_payment_amount,
        updated_at = v_now
    where id = v_folio_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'reservationId', p_reservation_id,
    'folioId', v_folio_id,
    'masterFolioId', v_master_folio_id,
    'roomNumber', v_reservation.room_number,
    'checkInDate', v_now
  );
end;
$$;

grant execute on function check_in_reservation to authenticated;

-- ── Backfill: link existing Guest folios that belong to groups ─
-- For already-checked-in group reservations that only have a Guest folio,
-- create the missing hierarchy and link them.
DO $$
DECLARE
  r RECORD;
  v_master_folio_id text;
  v_gp_id text;
BEGIN
  FOR r IN
    SELECT DISTINCT res.group_profile_id, res.booking_group_id
    FROM reservations res
    WHERE res.status = 'CheckedIn'
      AND (res.group_profile_id IS NOT NULL OR res.booking_group_id IS NOT NULL)
  LOOP
    BEGIN
      v_master_folio_id := null;
      if r.group_profile_id is not null then
        v_master_folio_id := ensure_group_folio_hierarchy(r.group_profile_id, null, 'system-backfill');
      elsif r.booking_group_id is not null then
        select gp.id into v_gp_id
        from group_profiles gp
        where gp.code = r.booking_group_id or gp.id = r.booking_group_id
        limit 1;
        if v_gp_id is not null then
          v_master_folio_id := ensure_group_folio_hierarchy(v_gp_id, null, 'system-backfill');
        end if;
      end if;

      if v_master_folio_id is not null then
        -- Link Guest folios for this group's reservations to the Master
        update folios set parent_folio_id = v_master_folio_id
        where folio_type = 'Guest'
          and parent_folio_id is null
          and status = 'Open'
          and reservation_id in (
            select id from reservations
            where group_profile_id = r.group_profile_id
               or booking_group_id = r.booking_group_id
          );
      end if;
    EXCEPTION WHEN OTHERS THEN
      -- Skip errors on individual groups during backfill
      NULL;
    END;
  END LOOP;
END $$;
