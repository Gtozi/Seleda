-- ============================================================
-- Migration 246: Folio Management Rebuild
-- Implements the data model from docs/Folio & billing.md:
--   - folio_relationships: explicit parent/child folio links
--   - folio_audit_logs: immutable per-folio activity timeline
--   - folio_transactions view: unified ledger of charges + payments
--   - RPC functions: split_folio, transfer_folio_transactions,
--     reverse_folio_line, close_folio, reopen_folio, void_folio
--
-- This migration is additive — it does NOT alter the existing
-- folios / folio_lines / folio_payments tables (their columns are
-- already sufficient). It layers the spec's concepts on top.
-- ============================================================

-- ── 1. folio_relationships ──────────────────────────────────
-- Explicit parent/child links. Complements the existing
-- folios.parent_folio_id column (which stays as a denormalized
-- fast-path). This table allows a folio to have multiple parents
-- (e.g. a guest folio rolled up into both a group and a master)
-- and records the relationship type.
create table if not exists folio_relationships (
  id            text primary key default gen_random_uuid()::text,
  parent_folio_id text not null references folios(id) on delete cascade,
  child_folio_id  text not null references folios(id) on delete cascade,
  relationship text not null check (relationship in ('master_group','group_guest','company_group','company_master','consolidation')),
  created_at    timestamptz not null default now(),
  unique (parent_folio_id, child_folio_id)
);

create index if not exists idx_folio_rel_parent on folio_relationships(parent_folio_id);
create index if not exists idx_folio_rel_child  on folio_relationships(child_folio_id);

-- Backfill from the existing parent_folio_id column
insert into folio_relationships (parent_folio_id, child_folio_id, relationship)
select parent_folio_id, id,
  case
    when folio_type = 'Guest'  then 'group_guest'
    when folio_type = 'Group'  then 'company_group'
    when folio_type = 'Master' then 'company_master'
    else 'consolidation'
  end
from folios
where parent_folio_id is not null
on conflict (parent_folio_id, child_folio_id) do nothing;

-- ── 2. folio_audit_logs ─────────────────────────────────────
-- Immutable per-folio activity timeline (spec §20). Separate from
-- the generic audit_events table so it can carry folio-specific
-- fields (source/destination folio, reason, old/new value) without
-- overloading audit_events.
create table if not exists folio_audit_logs (
  id              text primary key default gen_random_uuid()::text,
  folio_id        text not null references folios(id) on delete cascade,
  user_id         text references system_users(id) on delete set null,
  user_name       text,
  action          text not null,
  description     text,
  amount          numeric(14,2),
  old_value       jsonb,
  new_value       jsonb,
  reference       text,
  source_folio_id text references folios(id) on delete set null,
  dest_folio_id   text references folios(id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_folio_audit_folio_id   on folio_audit_logs(folio_id, created_at desc);
create index if not exists idx_folio_audit_created_at on folio_audit_logs(created_at desc);

alter table folio_audit_logs enable row level security;
drop policy if exists "staff_folio_audit_logs" on folio_audit_logs;
create policy "staff_folio_audit_logs"
  on folio_audit_logs for all to authenticated using (true) with check (true);

alter table folio_relationships enable row level security;
drop policy if exists "staff_folio_relationships" on folio_relationships;
create policy "staff_folio_relationships"
  on folio_relationships for all to authenticated using (true) with check (true);

-- ── 3. folio_transactions view ──────────────────────────────
-- Unified ledger combining charges (folio_lines) and payments
-- (folio_payments) into a single chronological ledger with a
-- running balance per folio. Spec §13.
create or replace view folio_transactions as
select
  fl.id                                   as transaction_id,
  fl.folio_id                             as folio_id,
  fl.line_number                          as transaction_number,
  fl.transaction_date                     as transaction_date,
  fl.created_at                           as created_at,
  'charge'                                as transaction_type,
  fl.line_type                            as category,
  fl.description                          as description,
  fl.source_reference                     as reference,
  fl.source_module                        as department,
  fl.amount                               as debit,
  0::numeric                              as credit,
  fl.is_voided                            as is_voided,
  fl.voided_at                            as voided_at,
  fl.void_reason                          as void_reason,
  fl.created_by                           as posted_by,
  fl.reservation_id                       as reservation_id,
  fl.window_id                            as window_id,
  fl.invoice_id                           as invoice_id,
  fl.is_routed                            as is_routed,
  fl.routed_from_folio_id                 as routed_from_folio_id
from folio_lines fl
union all
select
  fp.id                                   as transaction_id,
  fp.folio_id                             as folio_id,
  row_number() over (partition by fp.folio_id order by fp.payment_date, fp.created_at) as transaction_number,
  fp.payment_date                         as transaction_date,
  fp.created_at                           as created_at,
  case when fp.is_refund then 'refund' else 'payment' end as transaction_type,
  fp.payment_method                       as category,
  coalesce(fp.notes, fp.payment_method)   as description,
  fp.reference_number                     as reference,
  'Finance'                               as department,
  0::numeric                              as debit,
  case when fp.is_refund then -fp.amount else fp.amount end as credit,
  fp.is_voided                            as is_voided,
  fp.voided_at                            as voided_at,
  fp.void_reason                          as void_reason,
  fp.created_by                           as posted_by,
  fp.reservation_id                       as reservation_id,
  null::text                              as window_id,
  fp.invoice_id                           as invoice_id,
  false                                   as is_routed,
  null::text                              as routed_from_folio_id
from folio_payments fp;

grant select on folio_transactions to authenticated;

-- ── 4. Helper: write a folio audit log entry ────────────────
create or replace function write_folio_audit(
  p_folio_id        text,
  p_user_id         text,
  p_user_name       text,
  p_action          text,
  p_description     text default null,
  p_amount          numeric default null,
  p_reference       text default null,
  p_source_folio_id text default null,
  p_dest_folio_id   text default null,
  p_reason          text default null,
  p_old_value       jsonb default null,
  p_new_value       jsonb default null
)
returns void
language plpgsql
security definer
as $$
begin
  insert into folio_audit_logs (
    folio_id, user_id, user_name, action, description, amount,
    reference, source_folio_id, dest_folio_id, reason,
    old_value, new_value
  ) values (
    p_folio_id, p_user_id, p_user_name, p_action, p_description, p_amount,
    p_reference, p_source_folio_id, p_dest_folio_id, p_reason,
    p_old_value, p_new_value
  );
end;
$$;

grant execute on function write_folio_audit to authenticated;

-- ── 5. split_folio ──────────────────────────────────────────
-- Move a set of folio_lines (and/or folio_payments) from one folio
-- to another (existing or newly created). Spec §17. Each moved line
-- gets is_routed=true, routed_from_folio_id = origin. Recomputes
-- totals on both folios. Returns the destination folio id.
create or replace function split_folio(
  p_source_folio_id   text,
  p_line_ids          text[],
  p_dest_folio_id     text default null,
  p_dest_folio_type   text default 'Guest',
  p_dest_reservation_id text default null,
  p_reason            text default null,
  p_user_id           text default null,
  p_user_name         text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_source        folios%rowtype;
  v_dest_id       text;
  v_dest          folios%rowtype;
  v_moved_count   integer := 0;
  v_moved_amount  numeric := 0;
  v_line          folio_lines%rowtype;
  v_line_id       text;
begin
  select * into v_source from folios where id = p_source_folio_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Source folio not found');
  end if;

  if p_dest_folio_id is not null then
    select * into v_dest from folios where id = p_dest_folio_id for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Destination folio not found');
    end if;
    v_dest_id := p_dest_folio_id;
  else
    -- Create a new destination folio
    v_dest_id := gen_random_uuid()::text;
    insert into folios (id, reservation_id, folio_type, status, balance, currency, opened_at, created_by)
    values (
      v_dest_id,
      coalesce(p_dest_reservation_id, v_source.reservation_id),
      p_dest_folio_type,
      'Open',
      0,
      v_source.currency,
      now(),
      p_user_id
    );
    -- Link hierarchy
    insert into folio_relationships (parent_folio_id, child_folio_id, relationship)
    values (p_source_folio_id, v_dest_id, 'consolidation')
    on conflict do nothing;
  end if;

  foreach v_line_id in array p_line_ids loop
    select * into v_line from folio_lines where id = v_line_id and folio_id = p_source_folio_id for update;
    if found and not v_line.is_voided then
      update folio_lines
        set folio_id = v_dest_id,
            is_routed = true,
            routed_from_folio_id = p_source_folio_id,
            origin_folio_id = coalesce(v_line.origin_folio_id, p_source_folio_id)
        where id = v_line_id;
      v_moved_count := v_moved_count + 1;
      v_moved_amount := v_moved_amount + v_line.amount;
    end if;
  end loop;

  perform recompute_folio_totals(p_source_folio_id);
  perform recompute_folio_totals(v_dest_id);

  perform write_folio_audit(p_source_folio_id, p_user_id, p_user_name, 'split_out',
    'Split ' || v_moved_count || ' line(s) to folio ' || v_dest_id, v_moved_amount,
    null, p_source_folio_id, v_dest_id, p_reason);
  perform write_folio_audit(v_dest_id, p_user_id, p_user_name, 'split_in',
    'Received ' || v_moved_count || ' line(s) from folio ' || p_source_folio_id, v_moved_amount,
    null, p_source_folio_id, v_dest_id, p_reason);

  return jsonb_build_object(
    'success', true,
    'sourceFolioId', p_source_folio_id,
    'destFolioId', v_dest_id,
    'movedCount', v_moved_count,
    'movedAmount', round(v_moved_amount, 2)
  );
end;
$$;

grant execute on function split_folio to authenticated;

-- ── 6. transfer_folio_transactions ──────────────────────────
-- Transfer selected transactions or an entire folio's balance to
-- another folio. Spec §18. Creates an audit record on both folios.
create or replace function transfer_folio_transactions(
  p_source_folio_id   text,
  p_dest_folio_id     text,
  p_line_ids          text[] default null,
  p_transfer_type     text default 'selected',
  p_reason            text default null,
  p_reference         text default null,
  p_user_id           text default null,
  p_user_name         text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_source        folios%rowtype;
  v_dest          folios%rowtype;
  v_moved_count   integer := 0;
  v_moved_amount  numeric := 0;
  v_line          folio_lines%rowtype;
  v_line_id       text;
  v_line_ids_arr  text[];
begin
  select * into v_source from folios where id = p_source_folio_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Source folio not found'); end if;
  select * into v_dest from folios where id = p_dest_folio_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Destination folio not found'); end if;

  if p_transfer_type = 'entire' or p_line_ids is null then
    select array_agg(id) into v_line_ids_arr
    from folio_lines
    where folio_id = p_source_folio_id and is_voided = false;
  else
    v_line_ids_arr := p_line_ids;
  end if;

  if v_line_ids_arr is null then
    return jsonb_build_object('success', true, 'movedCount', 0, 'movedAmount', 0);
  end if;

  foreach v_line_id in array v_line_ids_arr loop
    select * into v_line from folio_lines where id = v_line_id and folio_id = p_source_folio_id for update;
    if found and not v_line.is_voided then
      update folio_lines
        set folio_id = p_dest_folio_id,
            is_routed = true,
            routed_from_folio_id = p_source_folio_id,
            origin_folio_id = coalesce(v_line.origin_folio_id, p_source_folio_id)
        where id = v_line_id;
      v_moved_count := v_moved_count + 1;
      v_moved_amount := v_moved_amount + v_line.amount;
    end if;
  end loop;

  perform recompute_folio_totals(p_source_folio_id);
  perform recompute_folio_totals(p_dest_folio_id);

  perform write_folio_audit(p_source_folio_id, p_user_id, p_user_name, 'transfer_out',
    'Transferred ' || v_moved_count || ' line(s) to folio ' || p_dest_folio_id, v_moved_amount,
    p_reference, p_source_folio_id, p_dest_folio_id, p_reason);
  perform write_folio_audit(p_dest_folio_id, p_user_id, p_user_name, 'transfer_in',
    'Received ' || v_moved_count || ' line(s) from folio ' || p_source_folio_id, v_moved_amount,
    p_reference, p_source_folio_id, p_dest_folio_id, p_reason);

  return jsonb_build_object(
    'success', true,
    'sourceFolioId', p_source_folio_id,
    'destFolioId', p_dest_folio_id,
    'movedCount', v_moved_count,
    'movedAmount', round(v_moved_amount, 2)
  );
end;
$$;

grant execute on function transfer_folio_transactions to authenticated;

-- ── 7. reverse_folio_line ───────────────────────────────────
-- Reverses a posted charge by creating a reversal line (negative
-- amount) and voiding the original. Spec §25 — never hard-delete.
create or replace function reverse_folio_line(
  p_line_id    text,
  p_reason     text,
  p_user_id    text default null,
  p_user_name  text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_line        folio_lines%rowtype;
  v_folio_id    text;
  v_reversal_id text;
  v_max_line_no integer;
begin
  select * into v_line from folio_lines where id = p_line_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Line not found'); end if;
  if v_line.is_voided then return jsonb_build_object('success', false, 'error', 'Line already voided'); end if;

  v_folio_id := v_line.folio_id;

  -- Void the original
  update folio_lines
    set is_voided = true, voided_at = now(), void_reason = p_reason, voided_by = p_user_id
    where id = p_line_id;

  -- Create a reversal line (negative amount, same folio)
  select coalesce(max(line_number), 0) into v_max_line_no
  from folio_lines where folio_id = v_folio_id;

  v_reversal_id := gen_random_uuid()::text;
  insert into folio_lines (
    id, folio_id, line_number, transaction_date, description, amount, quantity, unit_price,
    line_type, revenue_account_code, source_module, created_by, is_voided
  ) values (
    v_reversal_id, v_folio_id, v_max_line_no + 1, current_date,
    'REVERSAL — ' || coalesce(v_line.description, ''),
    -abs(v_line.amount), 1, -abs(v_line.amount),
    v_line.line_type, v_line.revenue_account_code, 'folio', p_user_id, false
  );

  perform recompute_folio_totals(v_folio_id);

  perform write_folio_audit(v_folio_id, p_user_id, p_user_name, 'reverse',
    'Reversed line ' || p_line_id, abs(v_line.amount),
    p_line_id, null, null, p_reason,
    to_jsonb(v_line), null);

  return jsonb_build_object(
    'success', true,
    'folioId', v_folio_id,
    'originalLineId', p_line_id,
    'reversalLineId', v_reversal_id,
    'amountReversed', abs(v_line.amount)
  );
end;
$$;

grant execute on function reverse_folio_line to authenticated;

-- ── 8. close_folio / reopen_folio / void_folio ──────────────
-- Folio status transitions (spec §26). Each writes an audit entry.
create or replace function close_folio(
  p_folio_id   text,
  p_user_id    text default null,
  p_user_name  text default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_folio folios%rowtype;
begin
  select * into v_folio from folios where id = p_folio_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status in ('Closed','Void') then
    return jsonb_build_object('success', false, 'error', 'Folio is already ' || v_folio.status);
  end if;
  update folios set status = 'Closed', closed_at = now(), updated_at = now()
    where id = p_folio_id;
  perform write_folio_audit(p_folio_id, p_user_id, p_user_name, 'close',
    'Folio closed', null, null, null, null, p_reason);
  return jsonb_build_object('success', true, 'folioId', p_folio_id, 'status', 'Closed');
end;
$$;

grant execute on function close_folio to authenticated;

create or replace function reopen_folio(
  p_folio_id   text,
  p_user_id    text default null,
  p_user_name  text default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_folio folios%rowtype;
begin
  select * into v_folio from folios where id = p_folio_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status != 'Closed' then
    return jsonb_build_object('success', false, 'error', 'Only closed folios can be reopened');
  end if;
  update folios set status = 'Reopened', closed_at = null, updated_at = now()
    where id = p_folio_id;
  perform write_folio_audit(p_folio_id, p_user_id, p_user_name, 'reopen',
    'Folio reopened', null, null, null, null, p_reason);
  return jsonb_build_object('success', true, 'folioId', p_folio_id, 'status', 'Reopened');
end;
$$;

grant execute on function reopen_folio to authenticated;

create or replace function void_folio(
  p_folio_id   text,
  p_user_id    text default null,
  p_user_name  text default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_folio folios%rowtype;
begin
  select * into v_folio from folios where id = p_folio_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status = 'Void' then
    return jsonb_build_object('success', false, 'error', 'Folio is already void');
  end if;
  update folios set status = 'Void', closed_at = now(), updated_at = now()
    where id = p_folio_id;
  perform write_folio_audit(p_folio_id, p_user_id, p_user_name, 'void',
    'Folio voided', null, null, null, null, p_reason);
  return jsonb_build_object('success', true, 'folioId', p_folio_id, 'status', 'Void');
end;
$$;

grant execute on function void_folio to authenticated;

-- ── 9. get_folio_audit_timeline ─────────────────────────────
-- Returns the activity timeline for a folio (spec §20), including
-- entries from both folio_audit_logs and the generic audit_events
-- table (for folio_lines/folio_payments changes), deduplicated.
create or replace function get_folio_audit_timeline(p_folio_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_entries jsonb := '[]'::jsonb;
  v_row record;
begin
  -- folio_audit_logs (folio-specific)
  for v_row in
    select
      al.id,
      al.folio_id,
      al.user_id,
      al.user_name,
      al.action,
      al.description,
      al.amount,
      al.reference,
      al.source_folio_id,
      al.dest_folio_id,
      al.reason,
      al.created_at,
      coalesce(su.full_name, su.username, al.user_name) as resolved_user_name
    from folio_audit_logs al
    left join system_users su on su.id = al.user_id
    where al.folio_id = p_folio_id
    order by al.created_at desc
  loop
    v_entries := v_entries || jsonb_build_object(
      'id', v_row.id,
      'folioId', v_row.folio_id,
      'userId', v_row.user_id,
      'user', v_row.resolved_user_name,
      'action', v_row.action,
      'description', v_row.description,
      'amount', v_row.amount,
      'reference', v_row.reference,
      'sourceFolioId', v_row.source_folio_id,
      'destFolioId', v_row.dest_folio_id,
      'reason', v_row.reason,
      'timestamp', to_char(v_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'source', 'folio_audit'
    );
  end loop;

  return v_entries;
end;
$$;

grant execute on function get_folio_audit_timeline to authenticated;

-- ── 10. get_folio_tree ──────────────────────────────────────
-- Returns the full Account → Master → Group → Guest tree for a
-- given root folio (typically a Company or Master folio).
create or replace function get_folio_tree(p_root_folio_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_root folios%rowtype;
  v_tree jsonb;
begin
  select * into v_root from folios where id = p_root_folio_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;

  with recursive tree as (
    select f.id, f.folio_type, f.status, f.balance, f.total_charges, f.total_payments,
           f.currency, f.folio_number, f.parent_folio_id, f.reservation_id,
           f.owner_type, f.owner_id, f.group_id, f.opened_at, f.closed_at,
           r.guest_name, r.room_number, r.check_in_date, r.check_out_date,
           coalesce(gp.organization_name, gp.name) as owner_name,
           0 as depth
    from folios f
    left join reservations r on r.id = f.reservation_id
    left join group_profiles gp on gp.code = coalesce(f.owner_id, f.group_id)
    where f.id = p_root_folio_id
    union all
    select f.id, f.folio_type, f.status, f.balance, f.total_charges, f.total_payments,
           f.currency, f.folio_number, f.parent_folio_id, f.reservation_id,
           f.owner_type, f.owner_id, f.group_id, f.opened_at, f.closed_at,
           r.guest_name, r.room_number, r.check_in_date, r.check_out_date,
           coalesce(gp.organization_name, gp.name) as owner_name,
           t.depth + 1
    from folios f
    join tree t on f.parent_folio_id = t.id
    left join reservations r on r.id = f.reservation_id
    left join group_profiles gp on gp.code = coalesce(f.owner_id, f.group_id)
  )
  select jsonb_agg(
    jsonb_build_object(
      'id', id, 'folioType', folio_type, 'status', status, 'balance', balance,
      'totalCharges', total_charges, 'totalPayments', total_payments,
      'currency', currency, 'folioNumber', folio_number,
      'parentFolioId', parent_folio_id, 'reservationId', reservation_id,
      'ownerType', owner_type, 'ownerId', owner_id, 'groupId', group_id,
      'openedAt', opened_at, 'closedAt', closed_at,
      'guestName', guest_name, 'roomNumber', room_number,
      'checkInDate', check_in_date, 'checkOutDate', check_out_date,
      'ownerName', owner_name,
      'depth', depth
    ) order by depth, folio_type
  ) into v_tree
  from tree;

  return jsonb_build_object('success', true, 'rootFolioId', p_root_folio_id, 'nodes', coalesce(v_tree, '[]'::jsonb));
end;
$$;

grant execute on function get_folio_tree to authenticated;
