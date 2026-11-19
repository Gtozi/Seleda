-- =============================================================================
-- Migration 501: Spa & Wellness — audit survives appointment deletion
-- =============================================================================
-- spa_appointment_history.appointment_id used ON DELETE CASCADE, so deleting
-- an appointment destroyed its entire audit trail. Dropping the FK keeps the
-- appointment_id value in history rows after the parent row is removed —
-- the trail stays queryable (including the 'deleted' entry the API now
-- writes before removing a row).

alter table public.spa_appointment_history
  drop constraint if exists spa_appointment_history_appointment_id_fkey;

-- Some environments may have created the FK under a different name; drop any
-- remaining foreign key on the column defensively.
do $$
declare
  fk record;
begin
  for fk in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
    where rel.relname = 'spa_appointment_history'
      and con.contype = 'f'
      and att.attname = 'appointment_id'
  loop
    execute format('alter table public.spa_appointment_history drop constraint %I', fk.conname);
  end loop;
end $$;
