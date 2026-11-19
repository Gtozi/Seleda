-- Migration 242: post_folio_charge_with_routing RPC
-- Wraps charge posting with automatic routing rule evaluation.
-- When a charge is posted to a Guest folio, this function:
--   1. Evaluates routing rules walking up the parent_folio_id chain
--   2. If a rule matches and max_amount cap is not exceeded, posts to the target folio
--      with origin_folio_id = the guest folio, is_routed = true
--   3. If no rule matches, posts to the origin folio as normal
-- This gives us the audit trail (origin_folio_id) without the complexity of moving lines.

create or replace function post_folio_charge_with_routing(
  p_origin_folio_id text,
  p_description text,
  p_amount numeric,
  p_quantity numeric default 1,
  p_line_type text default 'Extra',
  p_revenue_account_code text default null,
  p_user_id text default null,
  p_source_reference text default null,
  p_discount_percent numeric default 0,
  p_reservation_id text default null,
  p_source_module text default 'frontoffice'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_folio folios%rowtype;
  v_target_folio_id text;
  v_target_window_id text;
  v_rule_id text;
  v_max_amount numeric;
  v_already_routed numeric := 0;
  v_actual_target_folio_id text;
  v_result jsonb;
  v_base_line_id text;
  v_next_line integer;
  v_business_date date;
  v_now timestamp with time zone := now();
  v_base_amount numeric := p_amount;
  v_discounted_amount numeric;
  v_discount_amount numeric := 0.0;
  v_fee record;
  v_fee_amount numeric;
  v_total_fees numeric := 0.00;
  v_tax_amount numeric := 0.00;
  v_non_vat_fees numeric := 0.00;
  v_vat_name text := '';
  v_vat_rate numeric := 0;
  v_vat_account text := '';
  v_sc_total numeric := 0.00;
  v_misc_account text;
  v_tax_account text;
  v_default_window_id text;
  v_is_routed boolean := false;
begin
  -- Get business date
  select business_date into v_business_date from business_dates where id = 'current';
  if v_business_date is null then v_business_date := current_date; end if;

  -- Get account codes
  select code into v_misc_account from chart_of_accounts where name ilike '%miscellaneous%' limit 1;
  select code into v_tax_account from chart_of_accounts where name = 'Tax Payable' limit 1;
  if v_tax_account is null then
    select code into v_tax_account from chart_of_accounts where name ilike '%tax payable%' order by code asc limit 1;
  end if;

  -- Lock the origin folio
  select * into v_folio from folios where id = p_origin_folio_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Folio not found');
  end if;
  if v_folio.status != 'Open' then
    return jsonb_build_object('success', false, 'error', 'Folio is not open');
  end if;

  -- ── Evaluate routing rules ──────────────────────────────────────
  select * into v_target_folio_id, v_target_window_id, v_rule_id, v_max_amount
  from evaluate_routing_rules(p_origin_folio_id, p_line_type, v_business_date, p_reservation_id);

  -- Check max_amount cap if set
  if v_target_folio_id is not null and v_max_amount is not null and v_max_amount > 0 then
    -- Sum already-routed charges under this rule for this origin folio
    select coalesce(sum(amount), 0) into v_already_routed
    from folio_lines
    where origin_folio_id = p_origin_folio_id
      and is_routed = true
      and folio_id = v_target_folio_id;

    if v_already_routed + p_amount > v_max_amount then
      -- Cap exceeded — don't route, stay on origin folio
      v_target_folio_id := null;
      v_target_window_id := null;
      v_rule_id := null;
    end if;
  end if;

  -- Determine actual target
  if v_target_folio_id is not null then
    v_actual_target_folio_id := v_target_folio_id;
    v_is_routed := true;
  else
    v_actual_target_folio_id := p_origin_folio_id;
    v_is_routed := false;
  end if;

  -- Get or create default window for the target folio
  select id into v_default_window_id from folio_windows
  where folio_id = v_actual_target_folio_id and is_default = true limit 1;
  if not found then
    v_default_window_id := gen_random_uuid()::text;
    insert into folio_windows (id, folio_id, window_number, label, is_default)
    values (v_default_window_id, v_actual_target_folio_id, 1, 'Window 1', true);
  end if;

  -- Use the routing rule's target window if specified, otherwise default
  if v_target_window_id is not null then
    v_default_window_id := v_target_window_id;
  end if;

  -- Get next line number on the target folio
  select coalesce(max(line_number), 0) + 1 into v_next_line
  from folio_lines where folio_id = v_actual_target_folio_id;

  -- Apply discount
  if p_discount_percent > 0 then
    v_discount_amount := round(v_base_amount * p_discount_percent / 100, 2);
    v_discounted_amount := v_base_amount - v_discount_amount;
  else
    v_discounted_amount := v_base_amount;
  end if;

  -- Insert base charge line
  v_base_line_id := gen_random_uuid()::text;
  insert into folio_lines (
    id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
    line_type, target_folio, revenue_account_code, source_module, source_reference, created_by,
    window_id, origin_folio_id, is_routed, routed_from_folio_id
  ) values (
    v_base_line_id, v_actual_target_folio_id, v_next_line, v_business_date,
    p_description, v_discounted_amount, p_quantity,
    case when p_quantity > 0 then round(v_discounted_amount / p_quantity, 2) else v_discounted_amount end,
    p_line_type, v_folio.target_folio, p_revenue_account_code, p_source_module, p_source_reference, p_user_id,
    v_default_window_id,
    case when v_is_routed then p_origin_folio_id else p_origin_folio_id end,
    v_is_routed,
    case when v_is_routed then p_origin_folio_id else null end
  );

  -- Insert discount line if applicable
  if v_discount_amount > 0 then
    v_next_line := v_next_line + 1;
    insert into folio_lines (
      id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
      line_type, target_folio, revenue_account_code, source_module, created_by,
      window_id, origin_folio_id, is_routed, routed_from_folio_id
    ) values (
      gen_random_uuid()::text, v_actual_target_folio_id, v_next_line, v_business_date,
      'Discount @ ' || p_discount_percent || '% on ' || p_description,
      -v_discount_amount, 1, -v_discount_amount,
      'Discount', v_folio.target_folio, null, p_source_module, p_user_id,
      v_default_window_id, p_origin_folio_id, v_is_routed,
      case when v_is_routed then p_origin_folio_id else null end
    );
  end if;

  -- Phase 1: Calculate non-VAT fees
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
    v_next_line := v_next_line + 1;
    if v_fee.fee_type = 'percentage' then
      v_fee_amount := round(v_discounted_amount * v_fee.value / 100, 2);
    else
      v_fee_amount := v_fee.value;
    end if;
    v_non_vat_fees := v_non_vat_fees + v_fee_amount;

    if lower(v_fee.name) like '%service charge%' or lower(v_fee.name) like '%service%' then
      v_sc_total := v_sc_total + v_fee_amount;
    end if;

    insert into folio_lines (
      id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
      line_type, target_folio, revenue_account_code, source_module, created_by,
      window_id, origin_folio_id, is_routed, routed_from_folio_id
    ) values (
      gen_random_uuid()::text, v_actual_target_folio_id, v_next_line, v_business_date,
      v_fee.name || case when v_fee.fee_type = 'percentage' then ' @ ' || v_fee.value || '% on ' || p_description else ' (Fixed) on ' || p_description end,
      v_fee_amount, 1, v_fee_amount,
      case when lower(v_fee.name) like '%service charge%' or lower(v_fee.name) like '%service%' then 'ServiceCharge' else 'Extra' end,
      v_folio.target_folio,
      coalesce(v_fee.account_code, v_misc_account),
      p_source_module, p_user_id,
      v_default_window_id, p_origin_folio_id, v_is_routed,
      case when v_is_routed then p_origin_folio_id else null end
    );
  end loop;

  -- Phase 2: Calculate VAT
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
    v_tax_amount := round((v_discounted_amount + v_non_vat_fees) * v_vat_rate / 100, 2);
    v_next_line := v_next_line + 1;
    insert into folio_lines (
      id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
      line_type, target_folio, revenue_account_code, source_module, created_by,
      window_id, origin_folio_id, is_routed, routed_from_folio_id
    ) values (
      gen_random_uuid()::text, v_actual_target_folio_id, v_next_line, v_business_date,
      v_vat_name || ' @ ' || v_vat_rate || '% on ' || p_description,
      v_tax_amount, 1, v_tax_amount, 'Tax',
      v_folio.target_folio,
      coalesce(v_vat_account, v_tax_account),
      p_source_module, p_user_id,
      v_default_window_id, p_origin_folio_id, v_is_routed,
      case when v_is_routed then p_origin_folio_id else null end
    );
  end if;

  v_total_fees := v_non_vat_fees + v_tax_amount;

  -- Update target folio balance
  update folios
  set balance = balance + v_discounted_amount + v_total_fees,
      total_charges = total_charges + v_discounted_amount + v_total_fees,
      tax_total = tax_total + v_tax_amount,
      service_charge_total = service_charge_total + v_sc_total,
      updated_at = v_now
  where id = v_actual_target_folio_id;

  return jsonb_build_object(
    'success', true,
    'folioId', v_actual_target_folio_id,
    'originFolioId', p_origin_folio_id,
    'isRouted', v_is_routed,
    'ruleId', v_rule_id,
    'baseAmount', v_base_amount,
    'discountedAmount', v_discounted_amount,
    'discountAmount', v_discount_amount,
    'feesTotal', v_total_fees,
    'taxAmount', v_tax_amount,
    'serviceChargeTotal', v_sc_total,
    'lineId', v_base_line_id
  );
end;
$$;
