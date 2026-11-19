-- =============================================================================
-- Migration 504: Spa & Wellness — automated appointment reminders
-- =============================================================================
-- Reminders were entirely manual. This adds the bookkeeping the reminder
-- sweep needs:
--   * spa_appointments.reminder_sent_at — set when a reminder goes out; the
--     sweep claims rows by flipping it under a NULL guard so concurrent
--     schedulers never double-send.
--   * general.appointment_reminder setting — {"enabled":true,
--     "hours_ahead":24,"channel":"Email"} read by sendAppointmentReminders().
-- =============================================================================

alter table public.spa_appointments
  add column if not exists reminder_sent_at timestamptz;

create index if not exists idx_spa_appointments_reminder
  on public.spa_appointments (appointment_date)
  where reminder_sent_at is null
    and status in ('Requested', 'Confirmed');

insert into public.spa_settings (id, section, name, description, value, status)
select * from (values
  ('general.appointment_reminder','general','Appointment Reminder',
   'Automated guest reminder sent hours_ahead before the appointment start. channel: Email or SMS. enabled=false disables the sweep.',
   '{"enabled":true,"hours_ahead":24,"channel":"Email"}'::jsonb,'Configured')
) as t(id, section, name, description, value, status)
where not exists (select 1 from public.spa_settings where id = t.id);

-- Hourly sweep — the daily spa_maintenance job alone would push reminders
-- too early/late. src/server/scheduler.ts maps 'spa_reminders' to the
-- sendAppointmentReminders + dispatchDueCommunications handlers.
insert into scheduled_jobs (name, type, schedule_cron, config, enabled)
select 'Spa Reminders & Comms Dispatch', 'spa_reminders', '7 * * * *', '{}', true
where not exists (
  select 1 from scheduled_jobs where type = 'spa_reminders'
);
