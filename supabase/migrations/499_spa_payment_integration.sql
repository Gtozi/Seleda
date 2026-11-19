-- =============================================================================
-- Migration 499: Spa & Wellness — payment-method integration
-- =============================================================================
-- 'Gift Voucher' / 'Membership Credit' transactions and retail 'Room Charge'
-- sales previously recorded a payment method but debited nothing and left no
-- trace to the backing instrument. These columns link each charge to what
-- actually paid it:
--
--   spa_transactions.gift_card_id  → spa_gift_cards row debited
--   spa_transactions.membership_id → spa_memberships row debited
--   spa_retail_sales.folio_id /
--   folio_line_id                  → folio line a Room Charge posted to
-- =============================================================================

alter table public.spa_transactions
  add column if not exists gift_card_id  text references public.spa_gift_cards(id)  on delete set null,
  add column if not exists membership_id text references public.spa_memberships(id) on delete set null;

alter table public.spa_retail_sales
  add column if not exists folio_id      text,
  add column if not exists folio_line_id text;

create index if not exists idx_spa_txn_gift_card  on public.spa_transactions(gift_card_id);
create index if not exists idx_spa_txn_membership on public.spa_transactions(membership_id);
