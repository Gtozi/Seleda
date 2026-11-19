-- 485: Spa Communication Center — guest communications log
-- Replaces mock data. Broadcast rows use recipient_id NULL +
-- recipient_name like 'All Members'.

create table if not exists public.spa_communications (
  id             text primary key,
  comm_type      text not null
                 check (comm_type in ('SMS','Email','Push Notification')),
  recipient_id   text references public.guests(id) on delete set null,
  recipient_name text not null,
  subject        text,
  message        text not null,
  category       text not null
                 check (category in ('Appointment Reminder','Wellness Tips','Promotional Campaign','Membership Notice','Service Update')),
  status         text not null default 'Sent'
                 check (status in ('Sent','Delivered','Opened','Failed','Scheduled')),
  sent_at        timestamptz,
  scheduled_for  timestamptz,
  property_id    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.spa_communications enable row level security;

drop policy if exists spa_communications_all on public.spa_communications;
create policy spa_communications_all on public.spa_communications
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.spa_communications to authenticated;

create index if not exists idx_spa_communications_status on public.spa_communications(status);
create index if not exists idx_spa_communications_type on public.spa_communications(comm_type);
create index if not exists idx_spa_communications_sent on public.spa_communications(sent_at desc);

-- ── Seed (former mock communications) ──────────────────────────────
insert into public.spa_communications
  (id, comm_type, recipient_id, recipient_name, subject, message,
   category, status, sent_at, scheduled_for)
values
  ('COM-001','SMS','GST-001','Sarah Johnson',null,
   'Reminder: Your Swedish Massage appointment is tomorrow at 9:00 AM. Reply C to cancel.',
   'Appointment Reminder','Delivered','2026-07-30T14:30:00Z',null),
  ('COM-002','Email','GST-002','Michael Williams','Your Spa Membership is Expiring Soon',
   'Dear Michael, your monthly spa membership will expire on July 31st. Renew now to continue enjoying unlimited spa access.',
   'Membership Notice','Opened','2026-07-29T10:00:00Z',null),
  ('COM-003','Push Notification','GST-003','Emma Davis',null,
   'Special Offer: 20% off all facials this weekend! Book now.',
   'Promotional Campaign','Sent','2026-07-31T09:00:00Z',null),
  ('COM-004','Email',null,'All Members','Summer Wellness Tips',
   'Stay hydrated and protect your skin this summer with our summer wellness guide.',
   'Wellness Tips','Sent','2026-07-28T16:00:00Z',null),
  ('COM-005','SMS','GST-004','James Brown',null,
   'Your Couples Retreat Package is confirmed for August 15th at 2:00 PM.',
   'Appointment Reminder','Scheduled','2026-07-31T11:00:00Z','2026-08-14T10:00:00Z')
on conflict (id) do nothing;
