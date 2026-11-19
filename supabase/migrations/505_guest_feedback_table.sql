-- =============================================================================
-- Migration 505: Guest feedback table for the guest-portal /feedback endpoint
-- =============================================================================
-- guestMobilePortal.routes.ts POST /feedback has always inserted into
-- public.guest_feedback — a table no migration ever created (the portal 500s
-- on every submission). The existing guest_feedbacks / fb_guest_feedback /
-- sales_guest_feedback tables are different shapes owned by other modules;
-- this creates the shape the portal actually writes and reads, and gives the
-- spa satisfaction report a real data source.
-- =============================================================================

create table if not exists public.guest_feedback (
  id            text primary key default gen_random_uuid()::text,
  property_id   uuid references public.properties(id) on delete set null,
  reservation_id text,
  guest_id      text references public.guests(id) on delete set null,
  category      text not null,
  rating        integer not null check (rating between 1 and 5),
  comments      text,
  submitted_by  text,
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.guest_feedback enable row level security;

drop policy if exists guest_feedback_all on public.guest_feedback;
create policy guest_feedback_all on public.guest_feedback
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.guest_feedback to authenticated;

create index if not exists idx_guest_feedback_property  on public.guest_feedback(property_id);
create index if not exists idx_guest_feedback_guest     on public.guest_feedback(guest_id);
create index if not exists idx_guest_feedback_category  on public.guest_feedback(category);
create index if not exists idx_guest_feedback_submitted on public.guest_feedback(submitted_at desc);
