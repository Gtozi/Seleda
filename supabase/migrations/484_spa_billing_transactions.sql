-- 484: Spa Billing & Payments — transaction ledger
-- Replaces mock data. total is computed by the API (amount + tax +
-- service_charge + tip). appointment links are optional FKs.

create table if not exists public.spa_transactions (
  id              text primary key,
  guest_id        text references public.guests(id) on delete set null,
  guest_name      text,
  appointment_id  text references public.spa_appointments(id) on delete set null,
  description     text not null,
  amount          numeric(10,2) not null default 0 check (amount >= 0),
  tax             numeric(10,2) not null default 0 check (tax >= 0),
  service_charge  numeric(10,2) not null default 0 check (service_charge >= 0),
  tip             numeric(10,2) not null default 0 check (tip >= 0),
  total           numeric(10,2) not null default 0,
  payment_method  text not null
                  check (payment_method in ('Guest Folio','Credit/Debit Card','Mobile Wallet','Cash','Corporate Billing','Gift Voucher','Membership Credit')),
  status          text not null default 'Pending'
                  check (status in ('Pending','Completed','Refunded','Failed')),
  transaction_date date not null default current_date,
  room_number     text,
  property_id     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.spa_transactions enable row level security;

drop policy if exists spa_transactions_all on public.spa_transactions;
create policy spa_transactions_all on public.spa_transactions
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.spa_transactions to authenticated;

create index if not exists idx_spa_transactions_status on public.spa_transactions(status);
create index if not exists idx_spa_transactions_date on public.spa_transactions(transaction_date);
create index if not exists idx_spa_transactions_guest on public.spa_transactions(guest_id);

-- ── Seed (former mock transactions) ────────────────────────────────
insert into public.spa_transactions
  (id, guest_id, guest_name, appointment_id, description,
   amount, tax, service_charge, tip, total,
   payment_method, status, transaction_date, room_number)
values
  ('TXN-001','GST-001','Sarah Johnson',
   (select id from public.spa_appointments where id='APT-001'),
   'Swedish Massage (60 min)',120,10.80,12,20,162.80,
   'Credit/Debit Card','Completed','2026-07-31','305'),
  ('TXN-002','GST-002','Michael Williams',
   (select id from public.spa_appointments where id='APT-002'),
   'Deep Tissue Massage (90 min)',150,13.50,15,25,203.50,
   'Guest Folio','Completed','2026-07-31','212'),
  ('TXN-003','GST-003','Emma Davis',
   (select id from public.spa_appointments where id='APT-003'),
   'Hydrating Facial (45 min)',95,8.55,9.50,15,128.05,
   'Mobile Wallet','Completed','2026-07-31','118'),
  ('TXN-004','GST-004','James Brown',null,
   'Couples Retreat Package',350,31.50,35,50,466.50,
   'Gift Voucher','Pending','2026-07-31','407'),
  ('TXN-005','GST-005','Olivia Wilson',null,
   'Retail Purchase - Lavender Oil',45,4.05,0,0,49.05,
   'Credit/Debit Card','Completed','2026-07-30',null)
on conflict (id) do nothing;
