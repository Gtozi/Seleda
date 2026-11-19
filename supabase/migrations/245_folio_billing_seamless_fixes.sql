-- Migration 245: Seamless folio & billing fixes
--
-- 1. get_reservation_billing: add optional p_target_folio param so callers can
--    get a canonical (DB-sourced) charges/payments breakdown for just the A or
--    B side of a split folio, instead of the frontend recomputing it from
--    scratch via calculateFolioComponents(). Falls back to the owning folio's
--    own target_folio when a line/payment has target_folio = NULL (single,
--    non-split folio scenario) — mirrors the resolveTarget() logic already
--    used by GET /api/reservations/:id/folio-balance.
--
-- 2. close_folio_with_invoice: fix for folios that have no reservation_id
--    (Company / Master folios, owner_type='group_profile', added in
--    migration 243/238). Previously this errored with 'Reservation not
--    found for this folio' because it always looked up `reservations` by
--    folio.reservation_id. Now it branches: if the folio has an owner_id,
--    pull customer/tax info from group_profiles instead.

-- ============================================================
-- Part 1: get_reservation_billing with optional per-folio-side filter
-- ============================================================

drop function if exists get_reservation_billing(text);

create or replace function get_reservation_billing(
  p_reservation_id text,
  p_target_folio text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_reservation record;
  v_folio_ids text[];
  v_base_charges numeric := 0.0;
  v_service_charges numeric := 0.0;
  v_tax_charges numeric := 0.0;
  v_extra_charges numeric := 0.0;
  v_total_charges numeric := 0.0;
  v_total_payments numeric := 0.0;
  v_balance numeric := 0.0;
  v_discount_percent numeric := 0.0;
  v_discount_amount numeric := 0.0;
  v_lines jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_line record;
  v_pay record;
begin
  -- Get reservation
  select id, discount_percent, total_amount
  into v_reservation
  from reservations
  where id = p_reservation_id;

  if v_reservation is null then
    return jsonb_build_object('success', false, 'error', 'Reservation not found');
  end if;

  v_discount_percent := coalesce(v_reservation.discount_percent, 0.0);

  -- Get folio IDs for this reservation
  select array_agg(id) into v_folio_ids
  from folios
  where reservation_id = p_reservation_id;

  if v_folio_ids is null or array_length(v_folio_ids, 1) = 0 then
    return jsonb_build_object(
      'success', true,
      'reservation_id', p_reservation_id,
      'target_folio', p_target_folio,
      'subtotal', 0.0,
      'discount_percent', v_discount_percent,
      'discount_amount', 0.0,
      'service_charges', 0.0,
      'tax_amount', 0.0,
      'extra_charges', 0.0,
      'total_charges', 0.0,
      'total_payments', 0.0,
      'balance', 0.0,
      'lines', '[]'::jsonb,
      'payments', '[]'::jsonb
    );
  end if;

  -- Aggregate charges by line_type from folio_lines (non-voided), resolving
  -- each line's effective folio side (target_folio, falling back to the
  -- owning folio's own target_folio when the line itself has none set).
  for v_line in
    select
      fl.id,
      fl.folio_id,
      fl.line_number,
      fl.transaction_date,
      fl.description,
      fl.amount,
      fl.quantity,
      fl.unit_price,
      fl.line_type,
      fl.target_folio,
      fl.revenue_account_code,
      fl.source_module,
      fl.source_reference,
      fl.is_voided,
      fl.created_at,
      coalesce(fl.target_folio, f.target_folio) as effective_target_folio
    from folio_lines fl
    join folios f on f.id = fl.folio_id
    where fl.folio_id = any(v_folio_ids)
    and fl.is_voided = false
    and (p_target_folio is null or coalesce(fl.target_folio, f.target_folio) = p_target_folio)
    order by fl.line_number asc
  loop
    v_lines := v_lines || jsonb_build_object(
      'id', v_line.id,
      'folioId', v_line.folio_id,
      'lineNumber', v_line.line_number,
      'transactionDate', to_char(v_line.transaction_date, 'YYYY-MM-DD'),
      'description', v_line.description,
      'amount', v_line.amount,
      'quantity', v_line.quantity,
      'unitPrice', v_line.unit_price,
      'lineType', v_line.line_type,
      'targetFolio', v_line.effective_target_folio,
      'revenueAccountCode', v_line.revenue_account_code,
      'sourceModule', v_line.source_module,
      'sourceReference', v_line.source_reference,
      'isVoided', v_line.is_voided,
      'createdAt', to_char(v_line.created_at, 'YYYY-MM-DD"T"HH24:MI:SS')
    );

    -- Categorize by line_type
    if v_line.line_type = 'Tax' then
      v_tax_charges := v_tax_charges + v_line.amount;
    elsif v_line.line_type = 'ServiceCharge' then
      v_service_charges := v_service_charges + v_line.amount;
    elsif v_line.line_type = 'Discount' then
      v_discount_amount := v_discount_amount + abs(v_line.amount);
    else
      v_base_charges := v_base_charges + v_line.amount;
    end if;
  end loop;

  v_total_charges := v_base_charges + v_service_charges + v_tax_charges + v_extra_charges;

  -- Aggregate payments from folio_payments (non-voided), same fallback rule.
  for v_pay in
    select
      fp.id,
      fp.folio_id,
      fp.payment_date,
      fp.amount,
      fp.payment_method,
      fp.payment_sub_type,
      fp.reference_number,
      fp.card_last_four,
      fp.is_voided,
      fp.is_refund,
      fp.target_folio,
      fp.notes,
      fp.created_at,
      coalesce(fp.target_folio, f.target_folio) as effective_target_folio
    from folio_payments fp
    join folios f on f.id = fp.folio_id
    where fp.folio_id = any(v_folio_ids)
    and fp.is_voided = false
    and (p_target_folio is null or coalesce(fp.target_folio, f.target_folio) = p_target_folio)
    order by fp.payment_date asc
  loop
    v_payments := v_payments || jsonb_build_object(
      'id', v_pay.id,
      'folioId', v_pay.folio_id,
      'paymentDate', to_char(v_pay.payment_date, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'amount', v_pay.amount,
      'paymentMethod', v_pay.payment_method,
      'paymentSubType', v_pay.payment_sub_type,
      'referenceNumber', v_pay.reference_number,
      'cardLastFour', v_pay.card_last_four,
      'isVoided', v_pay.is_voided,
      'isRefund', v_pay.is_refund,
      'targetFolio', v_pay.effective_target_folio,
      'notes', v_pay.notes,
      'createdAt', to_char(v_pay.created_at, 'YYYY-MM-DD"T"HH24:MI:SS')
    );

    v_total_payments := v_total_payments + v_pay.amount;
  end loop;

  v_balance := v_total_charges - v_total_payments;

  return jsonb_build_object(
    'success', true,
    'reservation_id', p_reservation_id,
    'target_folio', p_target_folio,
    'subtotal', round(v_base_charges, 2),
    'discount_percent', v_discount_percent,
    'discount_amount', round(v_discount_amount, 2),
    'service_charges', round(v_service_charges, 2),
    'tax_amount', round(v_tax_charges, 2),
    'extra_charges', round(v_extra_charges, 2),
    'total_charges', round(v_total_charges, 2),
    'total_payments', round(v_total_payments, 2),
    'balance', round(v_balance, 2),
    'lines', v_lines,
    'payments', v_payments
  );
end;
$$;

grant execute on function get_reservation_billing(text, text) to authenticated;
grant execute on function get_reservation_billing(text, text) to anon;

-- ============================================================
-- Part 2: close_folio_with_invoice — support reservation-less folios
-- (Company / Master, owner_type='group_profile') by sourcing customer/tax
-- info from group_profiles instead of requiring a reservation row.
-- ============================================================

create or replace function close_folio_with_invoice(p_folio_id text, p_user_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_folio folios%rowtype;
  v_reservation reservations%rowtype;
  v_group_profile record;
  v_folio_totals jsonb;
  v_invoice_id text;
  v_invoice_number text;
  v_charges numeric;
  v_payments numeric;
  v_balance numeric;
  v_payments_linked integer;
  v_customer_name text;
  v_customer_email text;
  v_customer_tin text;
  v_customer_vat_no text;
begin
  -- Get folio details
  select * into v_folio from folios where id = p_folio_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Folio not found');
  end if;

  -- Check if folio is already closed
  if v_folio.status = 'Closed' then
    return jsonb_build_object('success', false, 'error', 'Folio is already closed');
  end if;

  -- Resolve customer info: reservation-backed folio vs. company-level folio
  -- (Company / Master folios have reservation_id = NULL and owner_type = 'group_profile')
  if v_folio.reservation_id is not null then
    select * into v_reservation from reservations where id = v_folio.reservation_id;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Reservation not found for this folio');
    end if;
    v_customer_name := v_reservation.guest_name;
    v_customer_email := v_reservation.guest_email;
    v_customer_tin := v_reservation.guest_tin;
    v_customer_vat_no := v_reservation.guest_vat_no;
  elsif v_folio.owner_type = 'group_profile' and v_folio.owner_id is not null then
    select id, name, organization_name, tax_id, vat_number, contact_email
    into v_group_profile
    from group_profiles
    where id = v_folio.owner_id;

    if not found then
      return jsonb_build_object('success', false, 'error', 'Owning company profile not found for this folio');
    end if;

    v_customer_name := coalesce(v_group_profile.organization_name, v_group_profile.name);
    v_customer_email := v_group_profile.contact_email;
    v_customer_tin := v_group_profile.tax_id;
    v_customer_vat_no := v_group_profile.vat_number;
  else
    return jsonb_build_object('success', false, 'error', 'Folio has no reservation or owning company profile to bill');
  end if;

  -- Recompute folio totals
  select recompute_folio_totals(p_folio_id) into v_folio_totals;

  -- Calculate totals
  v_charges := coalesce(v_folio_totals->>'total_charges', '0')::numeric;
  v_payments := coalesce(v_folio_totals->>'total_payments', '0')::numeric;
  v_balance := coalesce(v_folio_totals->>'folio_balance', '0')::numeric;

  -- Generate invoice number
  v_invoice_number := 'INV-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  -- Create invoice document
  insert into invoice_documents (
    id, folio_id, invoice_number, invoice_type, issue_date, due_date,
    subtotal, tax_total, discount_total, total, amount_paid, status,
    customer_name, customer_email, customer_address, customer_tin, customer_vat_no,
    hotel_tin, hotel_vat_no, hotel_vat_date, payment_terms, notes,
    is_voided, created_by
  ) values (
    gen_random_uuid()::text,
    p_folio_id,
    v_invoice_number,
    case when v_folio.folio_type in ('Company', 'Master', 'Group') then 'Group Master' else 'Guest' end,
    current_date,
    current_date + interval '30 days',
    v_charges,
    0, -- TODO: Calculate from folio lines
    0, -- TODO: Calculate from folio lines
    v_charges,
    v_payments,
    case when v_balance <= 0 then 'Paid' else 'Issued' end,
    v_customer_name,
    v_customer_email,
    null,
    v_customer_tin,
    v_customer_vat_no,
    null, -- TODO: Get from global settings
    null, -- TODO: Get from global settings
    null, -- TODO: Get from global settings
    'Net 30',
    'Auto-generated on folio close',
    false,
    p_user_id
  ) returning id into v_invoice_id;

  -- Link all non-voided payments to the invoice
  update folio_payments
  set invoice_id = v_invoice_id
  where folio_id = p_folio_id
    and is_voided = false
    and invoice_id is null;

  get diagnostics v_payments_linked = row_count;

  -- Close the folio
  update folios
  set status = 'Closed',
      closed_at = current_timestamp,
      updated_at = current_timestamp
  where id = p_folio_id;

  -- Sync reservation payment status (only meaningful for reservation-backed folios)
  if v_folio.reservation_id is not null then
    perform sync_reservation_payment_status(p_folio_id);
  end if;

  return jsonb_build_object(
    'success', true,
    'folio_id', p_folio_id,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'invoice_status', case when v_balance <= 0 then 'Paid' else 'Issued' end,
    'payments_linked', v_payments_linked,
    'total_charges', v_charges,
    'total_payments', v_payments,
    'balance', v_balance
  );
end;
$$;

grant execute on function close_folio_with_invoice(text, text) to authenticated;
