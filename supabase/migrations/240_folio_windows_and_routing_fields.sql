-- Migration 240: Folio Windows + Routing fields on folio_lines
-- Implements the FolioWindow entity from the folio architecture spec.
-- Each folio can have multiple windows (sub-folios) for split billing:
--   Window 1 = Room & Tax (billed to company), Window 2 = Incidentals (billed to guest), etc.
-- Also adds routing audit fields to folio_lines so we can trace where a charge
-- originated vs where it was routed to.

-- ── 1. folio_windows table ──────────────────────────────────────────
create table if not exists folio_windows (
  id text primary key,
  folio_id text not null references folios(id) on delete cascade,
  window_number integer not null default 1,
  label text not null default 'Window 1',
  payment_method_id text,
  routing_rule_id text,
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique(folio_id, window_number)
);

create index if not exists idx_folio_windows_folio_id on folio_windows(folio_id);

-- ── 2. Add window_id to folio_lines (nullable for backward compat) ──
alter table folio_lines
  add column if not exists window_id text references folio_windows(id) on delete set null;

create index if not exists idx_folio_lines_window_id on folio_lines(window_id) where window_id is not null;

-- ── 3. Add routing audit fields to folio_lines ──────────────────────
-- origin_folio_id: the folio the charge was *originally* posted to (before routing)
-- is_routed: true if this line was swept from a child folio to a parent
-- routed_from_folio_id: the child folio it was swept from (if routed)
-- routed_from_window_id: the window it was swept from (if routed)
alter table folio_lines
  add column if not exists origin_folio_id text references folios(id) on delete set null,
  add column if not exists is_routed boolean not null default false,
  add column if not exists routed_from_folio_id text references folios(id) on delete set null,
  add column if not exists routed_from_window_id text references folio_windows(id) on delete set null;

create index if not exists idx_folio_lines_origin_folio_id on folio_lines(origin_folio_id) where origin_folio_id is not null;
create index if not exists idx_folio_lines_is_routed on folio_lines(is_routed) where is_routed = true;

-- ── 4. Add folio_number to folios (human-readable, property-scoped) ──
alter table folios
  add column if not exists folio_number text;

create index if not exists idx_folios_folio_number on folios(folio_number) where folio_number is not null;

-- ── 5. Add split_rules JSON to folios (for window auto-assignment) ──
alter table folios
  add column if not exists split_rules jsonb default '{}'::jsonb;

-- ── 6. Add disputed status to folio_lines ───────────────────────────
alter table folio_lines
  drop constraint if exists folio_lines_status_check;
-- folio_lines doesn't have a status column; the is_voided flag is used instead.
-- Add a dispute_reason column for the disputed workflow.
alter table folio_lines
  add column if not exists is_disputed boolean not null default false,
  add column if not exists dispute_reason text,
  add column if not exists disputed_at timestamp with time zone,
  add column if not exists disputed_by text references system_users(id) on delete set null;

create index if not exists idx_folio_lines_is_disputed on folio_lines(is_disputed) where is_disputed = true;

-- ── 7. Add bill_to_entity_id to folios (links Master folio to group_profiles) ──
alter table folios
  add column if not exists bill_to_entity_id text references group_profiles(id) on delete set null;

create index if not exists idx_folios_bill_to_entity_id on folios(bill_to_entity_id) where bill_to_entity_id is not null;

-- ── 8. Backfill: create a default Window 1 for every existing folio ──
-- This ensures backward compatibility — every folio has at least one window.
do $$
begin
  insert into folio_windows (id, folio_id, window_number, label, is_default)
  select
    gen_random_uuid()::text,
    f.id,
    1,
    case
      when f.folio_type = 'Master' then 'Room & Tax'
      when f.folio_type = 'Group' then 'Group Charges'
      when f.folio_type = 'Company' then 'Company Charges'
      else 'Window 1'
    end,
    true
  from folios f
  where not exists (
    select 1 from folio_windows fw where fw.folio_id = f.id
  );
end $$;

-- ── 9. Backfill: link existing folio_lines to the default window ──
do $$
begin
  update folio_lines fl
  set window_id = fw.id
  from folio_windows fw
  where fw.folio_id = fl.folio_id
    and fw.is_default = true
    and fl.window_id is null;
end $$;

-- ── 10. Backfill: set origin_folio_id for existing lines (they weren't routed) ──
do $$
begin
  update folio_lines
  set origin_folio_id = folio_id
  where origin_folio_id is null;
end $$;
