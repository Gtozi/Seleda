-- Migration 655: guest portal authentication
-- Guests are not system_users, so they get their own credential columns on
-- guests plus a dedicated guest_sessions table. The bootstrap credential is
-- the guest's own id (matched when password_hash IS NULL); on first login the
-- server stores the hash and sets force_password_change so the guest must
-- choose a real password before using the portal.

alter table public.guests
  add column if not exists password_hash text,
  add column if not exists force_password_change boolean not null default false,
  add column if not exists password_updated_at timestamptz,
  add column if not exists last_login_at timestamptz;

create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_id text not null references public.guests(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_activity timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists guest_sessions_token_hash_idx
  on public.guest_sessions (token_hash) where revoked_at is null;
create index if not exists guest_sessions_guest_idx
  on public.guest_sessions (guest_id);
create index if not exists guest_sessions_expires_idx
  on public.guest_sessions (expires_at);

alter table public.guest_sessions enable row level security;

-- No client-facing policies: sessions are only read/written server-side via
-- the service-role client. Grant authenticated so the admin client path and
-- future RLS-aware queries work consistently with the other guest tables.
grant select, insert, update on public.guest_sessions to authenticated;

comment on table public.guest_sessions is
  'Guest portal sessions — bearer token hashes for guest logins (name + password). Mirrors user_sessions but keyed to guests.id.';
