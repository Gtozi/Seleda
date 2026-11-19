-- 483: Spa Gift Cards & Vouchers
-- Replaces mock data. remaining_balance supports partial redemption;
-- status transitions are enforced by the API layer.

create table if not exists public.spa_gift_cards (
  id                    text primary key,
  card_type             text not null
                        check (card_type in ('Spa Gift Card','Treatment Voucher','Promotional Coupon','Membership Credit')),
  code                  text not null unique,
  value                 numeric(10,2) not null check (value > 0),
  remaining_balance     numeric(10,2) not null check (remaining_balance >= 0),
  status                text not null default 'Active'
                        check (status in ('Active','Redeemed','Expired','Suspended')),
  purchaser_id          text references public.guests(id) on delete set null,
  purchaser_name        text,
  recipient_id          text references public.guests(id) on delete set null,
  recipient_name        text,
  issue_date            date not null default current_date,
  expiry_date           date,
  applicable_treatments text[] not null default '{}',
  notes                 text,
  redeemed_at           timestamptz,
  property_id           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.spa_gift_cards enable row level security;

drop policy if exists spa_gift_cards_all on public.spa_gift_cards;
create policy spa_gift_cards_all on public.spa_gift_cards
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.spa_gift_cards to authenticated;

create index if not exists idx_spa_gift_cards_status on public.spa_gift_cards(status);
create index if not exists idx_spa_gift_cards_expiry on public.spa_gift_cards(expiry_date);

-- ── Seed (former mock cards; purchaser/recipient linked to real guests) ──
insert into public.spa_gift_cards
  (id, card_type, code, value, remaining_balance, status,
   purchaser_id, purchaser_name, recipient_id, recipient_name,
   issue_date, expiry_date, applicable_treatments, notes)
values
  ('GFT-001','Spa Gift Card','SPA-GIFT-2026-001',200,200,'Active',
   'GST-001','Sarah Johnson','GST-002','Michael Williams',
   '2026-06-15','2027-06-15',array['All Services'],'Birthday gift'),
  ('GFT-002','Treatment Voucher','TMT-VCHR-2026-002',150,150,'Active',
   'GST-003','Emma Davis','GST-004','James Brown',
   '2026-07-01','2026-12-31',
   array['Swedish Massage','Deep Tissue Massage','Hot Stone Massage'],'Anniversary gift'),
  ('GFT-003','Promotional Coupon','PROMO-SUMMER-2026',50,50,'Active',
   null,'Hotel Marketing',null,null,
   '2026-07-01','2026-08-31',array['All Services'],'Summer promotion'),
  ('GFT-004','Membership Credit','MBR-CRDT-2026-004',100,0,'Redeemed',
   'GST-005','Olivia Wilson',null,null,
   '2026-05-15','2026-11-15',array['All Services'],'Membership renewal credit'),
  ('GFT-005','Spa Gift Card','SPA-GIFT-2025-005',300,300,'Expired',
   'GST-005','Robert Wilson',null,null,
   '2025-01-15','2026-01-15',array['All Services'],'Christmas gift')
on conflict (id) do nothing;
