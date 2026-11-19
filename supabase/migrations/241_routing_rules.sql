-- Migration 241: Routing Rules
-- Implements the RoutingRule entity from the folio architecture spec.
-- Routing rules drive auto-sweep behavior: when a charge is posted to a Guest folio,
-- the routing engine checks if the Guest folio's parent (Group) or grandparent (Master)
-- has a matching routing rule, and if so, sweeps the charge upward.
--
-- Example: "Company XYZ pays room+tax for all member folios, Aug 9-12"
--   scope_folio_id = Master folio ID
--   applies_to = 'charge_category'
--   charge_category_filter = ['Room', 'Tax']
--   target_window_id = Window 1 on the Master folio
--   effective_from = '2026-08-09', effective_to = '2026-08-12'

create table if not exists routing_rules (
  id text primary key,
  scope_folio_id text not null references folios(id) on delete cascade,
  applies_to text not null check (applies_to in ('all_charges', 'charge_category', 'specific_reservation')),
  charge_category_filter jsonb default '[]'::jsonb,
  specific_reservation_id text references reservations(id) on delete cascade,
  target_folio_id text references folios(id) on delete set null,
  target_window_id text references folio_windows(id) on delete set null,
  effective_from date,
  effective_to date,
  max_amount numeric(14,2),
  is_active boolean not null default true,
  priority integer not null default 0,
  created_by text references system_users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  notes text
);

create index if not exists idx_routing_rules_scope_folio_id on routing_rules(scope_folio_id);
create index if not exists idx_routing_rules_is_active on routing_rules(is_active) where is_active = true;

-- ── Add routing_rule_id to folios (for the folio's assigned routing profile) ──
-- This links a folio to the routing rule that governs its auto-sweep behavior.
-- Already added routing_rule_id to folio_windows in migration 240 (references routing_rules).
-- But routing_rules table didn't exist yet, so the FK wasn't added there.
-- Let's fix that:
alter table folio_windows
  drop constraint if exists folio_windows_routing_rule_id_fkey;
alter table folio_windows
  add constraint folio_windows_routing_rule_id_fkey
  foreign key (routing_rule_id) references routing_rules(id) on delete set null;

-- ── Add a helper function to evaluate routing rules for a charge ──
-- Given a folio_id (the origin), a line_type (charge category), and a transaction_date,
-- returns the target folio_id and window_id if a routing rule matches, or NULL if no match.
create or replace function evaluate_routing_rules(
  p_origin_folio_id text,
  p_line_type text,
  p_transaction_date date default current_date,
  p_reservation_id text default null
)
returns table (
  target_folio_id text,
  target_window_id text,
  rule_id text,
  max_amount numeric
)
language plpgsql
as $$
declare
  v_folio record;
  v_parent_id text;
  v_rule record;
begin
  -- Start from the origin folio and walk up the parent_folio_id chain
  v_parent_id := p_origin_folio_id;

  while v_parent_id is not null loop
    -- Get the current folio in the chain
    select * into v_folio from folios where id = v_parent_id;
    if not found then exit; end if;

    -- Check routing rules scoped to this folio (or its parent)
    for v_rule in
      select * from routing_rules
      where scope_folio_id = v_parent_id
        and is_active = true
        and (effective_from is null or effective_from <= p_transaction_date)
        and (effective_to is null or effective_to >= p_transaction_date)
      order by priority desc, created_at asc
    loop
      -- Check applies_to
      if v_rule.applies_to = 'all_charges' then
        return query select v_rule.target_folio_id, v_rule.target_window_id, v_rule.id, v_rule.max_amount;
        return;
      elsif v_rule.applies_to = 'charge_category' then
        if p_line_type = any(select value::text from jsonb_array_elements_text(v_rule.charge_category_filter)) then
          return query select v_rule.target_folio_id, v_rule.target_window_id, v_rule.id, v_rule.max_amount;
          return;
        end if;
      elsif v_rule.applies_to = 'specific_reservation' then
        if v_rule.specific_reservation_id = p_reservation_id then
          return query select v_rule.target_folio_id, v_rule.target_window_id, v_rule.id, v_rule.max_amount;
          return;
        end if;
      end if;
    end loop;

    -- Move up to the parent folio
    v_parent_id := v_folio.parent_folio_id;
  end loop;

  -- No routing rule matched
  return query select null::text, null::text, null::text, null::numeric;
end;
$$;
