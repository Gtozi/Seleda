-- ──────────────────────────────────────────────────────────────────────────
-- Migration 250: Sync rooms.status whenever reservation status changes
--
-- Problem: The Front Office Dashboard KPIs (occupancy %, available rooms,
-- ADR, RevPAR) are computed from rooms.status, but several code paths that
-- change reservation.status (the check_in_reservation() RPC, direct DB
-- updates, integrations) never updated rooms.status. This caused the
-- dashboard to drift — e.g. 10 reservations CheckedIn but only 1 room
-- showing 'Occupied Clean', so occupancy read 5.6% instead of ~56%.
--
-- Fix: A single AFTER UPDATE trigger on reservations that maps reservation
-- status transitions to the canonical room status:
--   CheckedIn            → room.status = 'Occupied Clean'
--   CheckedOut           → room.status = 'Vacant Dirty'
--   Cancelled / NoShow   → room.status = 'Vacant Clean'
--
-- This is the single source of truth for room-status sync. The explicit
-- rooms updates in the REST check-in/check-out routes are now redundant
-- but harmless (they set the same value the trigger already set) and serve
-- as a belt-and-suspenders fallback if the trigger is ever dropped.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function sync_room_status_on_reservation_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_room_number text;
begin
  -- Only act when the status column actually changed.
  if NEW.status = OLD.status then
    return new;
  end if;

  -- Resolve the room number: prefer the new room_number, fall back to the old
  -- one (e.g. a cancel/no-show may have cleared room_number on the new row).
  v_room_number := coalesce(NEW.room_number, OLD.room_number);
  if v_room_number is null then
    return new;
  end if;

  if NEW.status = 'CheckedIn' then
    update rooms set status = 'Occupied Clean' where number = v_room_number;
  elsif NEW.status = 'CheckedOut' then
    update rooms set status = 'Vacant Dirty' where number = v_room_number;
  elsif NEW.status in ('Cancelled', 'NoShow') then
    update rooms set status = 'Vacant Clean' where number = v_room_number;
  end if;

  return new;
end;
$$;

-- Drop existing trigger if re-running, then create.
drop trigger if exists trg_sync_room_status_on_reservation_change on reservations;
create trigger trg_sync_room_status_on_reservation_change
  after update on reservations
  for each row
  execute function sync_room_status_on_reservation_change();

grant execute on function sync_room_status_on_reservation_change to authenticated;

-- ── Backfill: reconcile rooms that are already out of sync ────────────────
-- For every CheckedIn reservation whose room is NOT 'Occupied *', fix it.
-- For every CheckedOut/Cancelled/NoShow reservation whose room is still
-- 'Occupied *', release it.
update rooms r
  set status = 'Occupied Clean'
  from reservations res
  where res.room_number = r.number
    and res.status = 'CheckedIn'
    and r.status not like 'Occupied%';

update rooms r
  set status = 'Vacant Dirty'
  from reservations res
  where res.room_number = r.number
    and res.status = 'CheckedOut'
    and r.status like 'Occupied%';

update rooms r
  set status = 'Vacant Clean'
  from reservations res
  where res.room_number = r.number
    and res.status in ('Cancelled', 'NoShow')
    and r.status like 'Occupied%';
