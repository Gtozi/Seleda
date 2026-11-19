-- =============================================================================
-- Migration 503: Reconcile divergent `guests` definitions
-- =============================================================================
-- Two definitions exist and both use CREATE TABLE IF NOT EXISTS, so the table
-- shape depends on which ran first:
--   * schema.sql      → name, status, loyalty_points, preferences, ...
--   * migration 443   → first_name, last_name, address, city, country, ...
-- Code selects from both shapes (spa/folio code uses `name`; CRM code uses
-- first_name/last_name), so whichever environment "lost" silently breaks.
-- This adds every column from both definitions and backfills `name` from the
-- CRM parts where it's missing.
-- =============================================================================

-- ── schema.sql columns that the 443 shape lacks ────────────────────────────
alter table public.guests add column if not exists name               text;
alter table public.guests add column if not exists status             text check (status in ('VIP', 'Regular', 'Loyalty Member'));
alter table public.guests add column if not exists loyalty_points     integer not null default 0;
alter table public.guests add column if not exists special_requests   text default '';
alter table public.guests add column if not exists total_spend        numeric not null default 0.00;
alter table public.guests add column if not exists nationality        text;
alter table public.guests add column if not exists tin                text;
alter table public.guests add column if not exists vat_no             text;
alter table public.guests add column if not exists vat_date           text;
alter table public.guests add column if not exists preferences        jsonb not null default '{}'::jsonb;
alter table public.guests add column if not exists identification_doc jsonb not null default '{}'::jsonb;

-- ── 443 columns that the schema.sql shape lacks ────────────────────────────
alter table public.guests add column if not exists first_name    text;
alter table public.guests add column if not exists last_name     text;
alter table public.guests add column if not exists address       text;
alter table public.guests add column if not exists city          text;
alter table public.guests add column if not exists country       text;
alter table public.guests add column if not exists date_of_birth date;
alter table public.guests add column if not exists gender        text;
alter table public.guests add column if not exists created_at    timestamptz default now();
alter table public.guests add column if not exists updated_at    timestamptz default now();

-- Keep `name` populated whichever shape the row was written through.
update public.guests
set name = trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
where (name is null or btrim(name) = '')
  and (first_name is not null or last_name is not null);

-- And the reverse, so CRM reads keep working for front-office-created rows.
update public.guests
set first_name = split_part(name, ' ', 1),
    last_name  = nullif(btrim(substr(name, length(split_part(name, ' ', 1)) + 2)), '')
where first_name is null
  and name is not null
  and btrim(name) <> '';
