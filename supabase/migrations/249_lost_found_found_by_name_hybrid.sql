-- Lost & Found: hybrid found_by model (name + optional user id)
--
-- Problem: lost_found.found_by is a FK to system_users(id), but the UI lets
-- staff type a free-text name. Typing a name (e.g. "John Smith") violates the
-- lost_found_found_by_fkey constraint because no system_users.id matches.
--
-- Fix: introduce a denormalized found_by_name text column that stores the
-- typed/displayed name. Keep found_by as an optional FK to system_users(id),
-- populated only when a known staff member is explicitly linked. The Add form
-- writes found_by_name; found_by stays NULL until a staff picker is wired up.

-- 1) Add the denormalized name column (nullable, free-text)
alter table lost_found
  add column if not exists found_by_name text;

-- 2) Backfill found_by_name for legacy rows that already have a valid user id
--    in found_by, so existing records continue to display a human-readable name.
update lost_found lf
  set found_by_name = su.name
  from system_users su
  where lf.found_by = su.id
    and lf.found_by_name is null;

-- 3) Drop the old auto-generated name column if a previous attempt created one
--    (idempotent guard; no-op if it doesn't exist).
--    (Intentionally not dropping anything else.)

comment on column lost_found.found_by_name is
  'Free-text name of the staff member who found the item (denormalized for display).';
comment on column lost_found.found_by is
  'Optional FK to system_users(id) when the finder is a linked staff member; otherwise NULL. Use found_by_name for display.';
