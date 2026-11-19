-- =============================================================================
-- Migration 498: Spa & Wellness — booking enforcement
-- =============================================================================
-- Closes the remaining booking-integrity gaps:
--
--   1. Double-booking race. findAppointmentConflicts() is a check-then-insert
--      read; two concurrent requests for the same slot both pass. A generated
--      tsrange column plus GiST exclusion constraints make overlap
--      physically impossible for slot-blocking statuses
--      (Requested / Confirmed / Checked In / In Treatment / Rescheduled —
--      the same set the application uses).
--
--   2. Operating-hours + cancellation-fee settings. The existing seeded
--      settings are display strings ("12 hours notice") that no code can
--      consume. This seeds structured values the booking/cancel paths read:
--        general.operating_hours   {"open":"08:00","close":"20:00"}
--        general.cancellation_fee  {"percent":0,"window_hours":12}
--      percent=0 keeps the fee disabled until configured.
-- =============================================================================

create extension if not exists btree_gist;

-- ── Materialized slot range ───────────────────────────────────────────────
-- A strict HH:MM guard keeps malformed legacy start_time values from breaking
-- the cast; such rows get a NULL slot and simply never participate in the
-- exclusion constraints below.
alter table public.spa_appointments
  add column if not exists slot tsrange
  generated always as (
    case
      when start_time ~ '^([01]\d|2[0-3]):[0-5]\d$'
      then tsrange(
        appointment_date::timestamp
          + split_part(start_time, ':', 1)::int * interval '1 hour'
          + split_part(start_time, ':', 2)::int * interval '1 minute',
        appointment_date::timestamp
          + split_part(start_time, ':', 1)::int * interval '1 hour'
          + split_part(start_time, ':', 2)::int * interval '1 minute'
          + make_interval(mins => duration_minutes)
      )
      else null
    end
  ) stored;

-- One therapist cannot hold two slot-blocking appointments at once.
alter table public.spa_appointments
  drop constraint if exists spa_appointments_therapist_slot_excl;
alter table public.spa_appointments
  add constraint spa_appointments_therapist_slot_excl
  exclude using gist (
    therapist_id with =,
    slot with &&
  )
  where (
    therapist_id is not null
    and status in ('Requested', 'Confirmed', 'Checked In', 'In Treatment', 'Rescheduled')
  );

-- Same for treatment rooms.
alter table public.spa_appointments
  drop constraint if exists spa_appointments_room_slot_excl;
alter table public.spa_appointments
  add constraint spa_appointments_room_slot_excl
  exclude using gist (
    room_id with =,
    slot with &&
  )
  where (
    room_id is not null
    and status in ('Requested', 'Confirmed', 'Checked In', 'In Treatment', 'Rescheduled')
  );

comment on column public.spa_appointments.slot is
  'Materialized booking window used by the therapist/room overlap exclusion '
  'constraints (migration 498). Derived from appointment_date + start_time + '
  'duration_minutes. tsrange (not tstzrange) because spa slots are '
  'property-local times and the generated expression must be immutable.';

-- ── Structured policy settings ────────────────────────────────────────────
insert into public.spa_settings (id, section, name, description, value, status)
select * from (values
  ('general.operating_hours','general','Operating Hours',
   'Spa open/close window; bookings outside it are rejected.',
   '{"open":"08:00","close":"20:00"}'::jsonb,'Configured'),
  ('general.cancellation_fee','general','Cancellation Fee',
   'Percent of the service price charged when a booking is cancelled inside window_hours of its start. 0 disables the fee.',
   '{"percent":0,"window_hours":12}'::jsonb,'Configured')
) as t(id, section, name, description, value, status)
where not exists (select 1 from public.spa_settings where id = t.id);
