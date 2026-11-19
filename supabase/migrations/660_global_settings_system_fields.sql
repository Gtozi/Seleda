-- System Settings (Admin → System Settings) persistence columns.
-- The UI previously edited timezone/language/date format/currency, night-audit
-- toggles, and email templates with no backing columns — writes were silently
-- dropped by filterKnownColumns().

alter table public.global_settings
  add column if not exists email_templates jsonb,
  add column if not exists timezone text,
  add column if not exists default_language text,
  add column if not exists date_format text,
  add column if not exists base_currency text,
  add column if not exists night_audit_post_room_charges boolean not null default true,
  add column if not exists night_audit_generate_summary boolean not null default true,
  add column if not exists night_audit_checkin_reminders boolean not null default true;
