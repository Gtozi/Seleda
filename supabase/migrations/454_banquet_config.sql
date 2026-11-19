-- 454_banquet_config.sql
-- Banquet & Events portal configuration (key/value store, property-scoped).
-- Replaces the placeholder-only Configuration tab with a DB-backed store.

create table if not exists public.banquet_event_config (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  config_key text not null,
  config_value text,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (property_id, config_key)
);

alter table public.banquet_event_config enable row level security;

-- Seed default configuration for the existing property
insert into public.banquet_event_config (property_id, config_key, config_value, updated_by)
select '18762279-a389-41c9-9169-7ebc682e9703'::uuid, k, v, 'system'
from (values
  ('hotel_name', 'Seleda Grand Hotel'),
  ('default_currency', 'ETB'),
  ('timezone', 'EAT'),
  ('language', 'en'),
  ('booking_lead_time_days', '7'),
  ('cancellation_policy', '24 hours'),
  ('deposit_required', 'true'),
  ('deposit_percentage', '20'),
  ('notify_new_booking', 'true'),
  ('notify_status_change', 'true'),
  ('notify_payment', 'true'),
  ('notify_alert_critical', 'true'),
  ('integrate_pos', 'true'),
  ('integrate_accounting', 'true'),
  ('integrate_calendar', 'false'),
  ('integrate_email', 'true'),
  ('integrate_sms', 'false')
) as t(k, v)
on conflict (property_id, config_key) do nothing;
